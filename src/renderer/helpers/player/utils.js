import shaka from 'shaka-player'
import i18n from '../../i18n/index'
import { sponsorBlockSkipSegments } from '../sponsorblock'
import { MIME_TYPE_CODECS_REGEX } from '../utils'
import { KeyboardShortcuts } from '../../../constants.js'

/** @typedef {import('../sponsorblock').SponsorBlockCategory} SponsorBlockCategory */

const RequestType = shaka.net.NetworkingEngine.RequestType

/** @type {Map<string, string>} */
export const PLAYER_LOCALE_MAPPINGS = new Map(process.env.SHAKA_LOCALE_MAPPINGS)

/*
  Mapping of Shaka localization keys for control labels to FreeTube shortcuts.
  See: https://github.com/shaka-project/shaka-player/blob/main/ui/locales/en.json
*/
export const SHAKA_CONTROL_KEYS_TO_SHORTCUTS = {
  MUTE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  UNMUTE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.MUTE,
  PLAY: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PAUSE: KeyboardShortcuts.VIDEO_PLAYER.PLAYBACK.PLAY,
  PICTURE_IN_PICTURE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  ENTER_PICTURE_IN_PICTURE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  EXIT_PICTURE_IN_PICTURE: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.PICTURE_IN_PICTURE,
  CAPTIONS: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.CAPTIONS,
  FULL_SCREEN: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN,
  EXIT_FULL_SCREEN: KeyboardShortcuts.VIDEO_PLAYER.GENERAL.FULLSCREEN
}

/**
 * @param {shaka.util.Error} error
 * @param {string} context
 * @param {string} videoId
 * @param {object?} details
 */
export function logShakaError(error, context, videoId, details) {
  const { Severity, Category, Code } = shaka.util.Error

  // shaka's error type also has a message property but that is apparently only available in uncompiled mode

  /** @type {keyof Severity} */
  const severityText = Object.keys(Severity).find((/** @type {keyof Severity} */ key) => Severity[key] === error.severity)

  /** @type {keyof Category} */
  const categoryText = Object.keys(Category).find((/** @type {keyof Category} */ key) => Category[key] === error.category)

  /** @type {keyof Code} */
  const codeText = Object.keys(Code).find((/** @type {keyof Code} */ key) => Code[key] === error.code)

  const message =
    `Player Error (category and code explainations here: https://shaka-project.github.io/shaka-player/docs/api/shaka.util.Error.html#value%3A${error.code})\n` +
    `Video ID: "${videoId}"\n` +
    `FreeTube player context: "${context}"\n\n` +
    `Severity: ${severityText} (${error.severity})\n` +
    `Category: ${categoryText} (${error.category})\n` +
    `Code: ${codeText} (${error.code})\n` +
    `Stack trace:\n${error.stack}`

  /** @type {*[]} */
  const args = [message]

  if (error.data && error.data.length > 0) {
    args.push(
      '\n\nshaka-player Data:',
      JSON.stringify(error.data)
    )
  }

  if (details) {
    args.push(
      '\n\nFreeTube data:',
      typeof details === 'object' ? JSON.stringify(details) : details
    )
  }

  console.error(...args)
}

/**
 * @param {string} videoId
 * @param {SponsorBlockCategory[]} categories
 */
export async function getSponsorBlockSegments(videoId, categories) {
  const segments = await sponsorBlockSkipSegments(videoId, categories)

  if (segments.length === 0) {
    return {
      segments: [],
      averageDuration: 0
    }
  }

  const averageDuration = segments.reduce((accumulator, segment) => {
    return accumulator + segment.videoDuration
  }, 0) / segments.length

  const mappedSegments = segments.map(({ category, segment: [startTime, endTime], UUID }) => {
    return {
      uuid: UUID,
      category,
      startTime,
      endTime
    }
  })

  mappedSegments.sort((a, b) => a.startTime - b.startTime)

  return {
    segments: mappedSegments,
    averageDuration
  }
}

/**
 * @param {SponsorBlockCategory} category
 */
export function translateSponsorBlockCategory(category) {
  switch (category) {
    case 'sponsor':
      return i18n.global.t('Video.Sponsor Block category.sponsor')
    case 'intro':
      return i18n.global.t('Video.Sponsor Block category.intro')
    case 'outro':
      return i18n.global.t('Video.Sponsor Block category.outro')
    case 'recap':
      return i18n.global.t('Video.Sponsor Block category.recap')
    case 'selfpromo':
      return i18n.global.t('Video.Sponsor Block category.self-promotion')
    case 'interaction':
      return i18n.global.t('Video.Sponsor Block category.interaction')
    case 'music_offtopic':
      return i18n.global.t('Video.Sponsor Block category.music offtopic')
    case 'filler':
      return i18n.global.t('Video.Sponsor Block category.filler')
    default:
      console.error(`Unknown translation for SponsorBlock category ${category}`)
      return category
  }
}

/**
 * Moves the captions that are the most similar to the display language to the top
 * and sorts the remaining ones alphabetically.
 * @param {{
 *   url: string,
 *   label: string,
 *   language: string,
 *   mimeType: string,
 *   isAutotranslated?: boolean
 * }[]} captions
 */
export function sortCaptions(captions) {
  const currentLocale = i18n.global.locale.value
  const userLocale = currentLocale.split('-') // ex. [en,US]

  const collator = new Intl.Collator([currentLocale, 'en'])

  return captions.sort((captionA, captionB) => {
    const aCode = captionA.language.split('-') // ex. [en,US] or [en]
    const bCode = captionB.language.split('-')
    const aName = captionA.label // ex: english (auto-generated)
    const bName = captionB.label
    const aIsAutotranslated = !!captionA.isAutotranslated
    const bIsAutotranslated = !!captionB.isAutotranslated
    if (aCode[0] === userLocale[0]) { // caption a has same language as user's locale
      if (bCode[0] === userLocale[0]) { // caption b has same language as user's locale
        if (bName.includes('auto')) {
          // prefer caption a: b is auto-generated captions
          return -1
        } else if (aName.includes('auto')) {
          // prefer caption b: a is auto-generated captions
          return 1
        } else if (bIsAutotranslated) {
          // prefer caption a: b is auto-translated captions
          return -1
        } else if (aIsAutotranslated) {
          // prefer caption b: a is auto-translated captions
          return 1
        } else if (aCode[1] === userLocale[1]) {
          // prefer caption a: caption a has same county code as user's locale
          return -1
        } else if (bCode[1] === userLocale[1]) {
          // prefer caption b: caption b has same county code as user's locale
          return 1
        } else if (aCode[1] === undefined) {
          // prefer caption a: no country code is better than wrong country code
          return -1
        } else if (bCode[1] === undefined) {
          // prefer caption b: no country code is better than wrong country code
          return 1
        }
      } else {
        // prefer caption a: b does not match user's language
        return -1
      }
    } else if (bCode[0] === userLocale[0]) {
      // prefer caption b: a does not match user's language
      return 1
    }
    // sort alphabetically
    return collator.compare(aName, bName)
  })
}

/**
 * When the build doesn't support the local API
 * we have to use Invidious' DASH manifest, instead of generating our own one.
 * This function cleans it up, so that we can use it.
 *
 * Here is a list of things this function does:
 * - Removes bogus roles and labels
 * - Extracts the languages from the audio URLs if available and adds it to the adapation sets
 * - Adds roles and labels when possible to add support for multiple audio tracks
 *
 * Things this function does not do:
 * - Separate DRC (Stable Volume) from their original counterparts
 * - Tag HDR video streams (Invidious puts all video streams in the same adaptation set,
 * to tag HDR and SDR streams we would have to separate them out into multiple adaptation sets)
 * @param {shaka.extern.xml.Node[]} periods
 */
export function repairInvidiousManifest(periods) {
  /** @type {shaka.extern.xml.Node[]} */
  const audioAdaptationSets = []

  for (const period of periods) {
    if (Array.isArray(period.children)) {
      for (const periodChild of period.children) {
        if (typeof periodChild !== 'string' && periodChild.tagName === 'AdaptationSet' && periodChild.attributes.mimeType?.startsWith('audio/')) {
          audioAdaptationSets.push(periodChild)
        }
      }
    }
  }

  // match YouTube's local API response with English
  const languageNames = new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' })

  for (const audioAdaptationSet of audioAdaptationSets) {
    // Invidious adds a label to every audio stream with it's bitrate
    // we need to remove those labels, so that they don't get treated as multiple audio tracks
    if (audioAdaptationSet.attributes.label) {
      delete audioAdaptationSet.attributes.label
    }

    if (Array.isArray(audioAdaptationSet.children)) {
      // Invidious gives the first audio stream the main role and then the rest of them the alternate role
      // regardless of which one is actually the main track
      const roleIndex = audioAdaptationSet.children.findIndex((adaptationSetChild) => {
        return typeof adaptationSetChild !== 'string' && adaptationSetChild.tagName === 'Role'
      })

      if (roleIndex !== -1) {
        audioAdaptationSet.children.splice(roleIndex, 1)
      }

      // Extract the language and audio content type from the URL if available
      // and add the language, role and label to the adaption set

      /** @type {shaka.extern.xml.Node | undefined} */
      const representation = audioAdaptationSet.children
        .find((child) => typeof child !== 'string' && child.tagName === 'Representation')

      if (representation && Array.isArray(representation.children)) {
        /** @type {string | undefined} */
        const baseUrl = representation.children
          .find((child) => typeof child !== 'string' && child.tagName === 'BaseURL')
          ?.children[0]

        if (baseUrl) {
          const url = new URL(baseUrl.replaceAll('&amp;', '&'))

          if (url.searchParams.has('xtags')) {
            const xtags = url.searchParams.get('xtags').split(':')

            const lang = xtags.find(xtag => xtag.startsWith('lang='))?.replace('lang=', '')
            const audioContent = xtags.find(xtag => xtag.startsWith('acont='))?.replace('acont=', '')

            const labelParts = []

            if (lang) {
              audioAdaptationSet.attributes.lang = lang

              labelParts.push(languageNames.of(lang))
            }

            if (audioContent) {
              let role

              switch (audioContent) {
                case 'original':
                  role = 'main'
                  labelParts.push('original')
                  break
                case 'dubbed':
                case 'dubbed-auto':
                  role = 'dub'
                  break
                case 'descriptive':
                  role = 'description'
                  labelParts.push('descriptive')
                  break
                case 'secondary':
                  role = 'alternate'
                  labelParts.push('secondary')
                  break
                default:
                  role = 'alternate'
                  labelParts.push('alternative')
                  break
              }

              audioAdaptationSet.children.push({
                tagName: 'Role',
                attributes: {
                  schemeIdUri: 'urn:mpeg:dash:role:2011',
                  value: role
                },
                children: [],
                parent: audioAdaptationSet
              })
            }

            if (labelParts.length > 0) {
              audioAdaptationSet.attributes.label = labelParts.join(' ')
            }
          }
        }
      }
    }
  }
}

/**
 * @param {shaka.extern.TrackList} variants
 * @param {number} bandwidthToMatch
 */
export function findMostSimilarAudioBandwidth(variants, bandwidthToMatch) {
  let closestAudioBandwithDifference = Infinity
  let closestVariant

  for (const variant of variants) {
    const difference = Math.abs(variant.audioBandwidth - bandwidthToMatch)

    if (difference < closestAudioBandwithDifference) {
      closestAudioBandwithDifference = difference
      closestVariant = variant
    }
  }

  return closestVariant
}

/**
 * @param {shaka.extern.AudioTrack[]} tracks
 */
export function deduplicateAudioTracks(tracks) {
  /** @type {Map<string, shaka.extern.AudioTrack>} */
  const knownTracks = new Map()

  for (const track of tracks) {
    const id = `${track.label}_${track.language}_${track.channelsCount}_${track.spatialAudio}`

    if (!knownTracks.has(id) || track.active) {
      knownTracks.set(id, track)
    }
  }

  return knownTracks
}

const HLS_AUDIO_PARAMS_ITAG_REGEX = /\/sgoap\/[^/]*?itag%3D(\d+)/
// eslint-disable-next-line no-control-regex
const HLS_QUOTED_STRING_REGEX = /[\0-\u001F"\u007F-\u009F]/g
const ITAG_139_SAMPLE_RATE = '22050'

/**
 * The HLS spec forbids control characters and double quotes inside strings
 * @param {string} text
 */
function cleanHlsString(text) {
  return text.trim().replaceAll(HLS_QUOTED_STRING_REGEX, '')
}

/**
 * @param {import('youtubei.js').Misc.Format} format
 */
function getAudioTrackName(format) {
  if (format.audio_track?.display_name) {
    return format.audio_track.display_name
  }

  if (format.language) {
    const languageName = new Intl.DisplayNames('en-US', {
      type: 'language',
      languageDisplay: 'standard',
      fallback: 'none'
    }).of(format.language)

    if (languageName !== undefined) {
      return languageName
    }
  }

  return 'Untitled'
}

/**
 * @param {string} codec
 * @param {number} channels
 * @param {number} sampleRate
 */
function createHlsAudioGroupId(codec, channels, sampleRate) {
  return `${codec.split('.', 1)[0]}-${channels}-${sampleRate || 0}`
}

/**
 * Patches the missing audio metadata into the HLS manifest
 * so that shaka-player treats the audio streams as the same track at different qualities
 * @param {ArrayBuffer | ArrayBufferView<ArrayBufferLike>} data
 * @param {import('youtubei.js').Misc.Format[]} audioFormats
 */
export function patchLiveHlsMainManifest(data, audioFormats) {
  const stringBody = new TextDecoder().decode(data)

  const linesToInsert = []
  const lines = stringBody.trim().split('\n')

  let firstStreamIndex = -1

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      continue
    }

    if (firstStreamIndex === -1) {
      firstStreamIndex = i
    }

    const itagMatch = lines[i + 1].match(HLS_AUDIO_PARAMS_ITAG_REGEX)

    if (itagMatch !== null) {
      const itag = parseInt(itagMatch[1])

      // Theoretically there could be xtags that we should match too
      // but I have yet to see a YouTube livestream with multiple audio tracks
      // so we'll only match by itag for now
      let format = audioFormats.find(format => format.itag === itag)

      if (!format && itag === 139) {
        // itag 139 appears in the HLS manifest but usually doesn't appear in the API response
        // it seems to be the same as itag 140 but with half the sample rate,
        // so we'll use everything but the sample rate from itag 140 instead
        format = audioFormats.find(format => format.itag === 140)
      }

      if (format) {
        const sampleRate = itag === 139 && format.itag !== 139 ? ITAG_139_SAMPLE_RATE : format.audio_sample_rate.toFixed(0)

        const groupId = createHlsAudioGroupId(format.mime_type.match(MIME_TYPE_CODECS_REGEX)[1], format.audio_channels, sampleRate)

        const mediaLine = `\
#EXT-X-MEDIA:\
TYPE=AUDIO,\
GROUP-ID="${groupId}",\
NAME="${cleanHlsString(getAudioTrackName(format))}",\
LANGUAGE="${format.language ? cleanHlsString(format.language) : 'und'}",\
DEFAULT=${format.is_original ? 'YES' : 'NO'},\
AUTOSELECT=${format.is_auto_dubbed ? 'NO' : 'YES'},\
CHANNELS=${format.audio_channels.toFixed(0)},\
SAMPLE-RATE=${sampleRate}`

        lines[i] = lines[i] + `,AUDIO=${groupId}`

        if (!linesToInsert.includes(mediaLine)) {
          linesToInsert.push(mediaLine)
        }
      }
    }

    // the next line is the URL line, which we can skip as it definitely won't match the stream info regex
    i++
  }

  if (linesToInsert.length > 0) {
    lines.splice(firstStreamIndex, 0, ...linesToInsert)
    lines.splice(1, 0, '#EXT-X-VERSION:7')

    const newString = lines.join('\n') + '\n'
    return new TextEncoder().encode(newString)
  }

  return data
}

/**
 * @param {string} match
 */
export function hlsProxiedUrlReplacer(match) {
  const url = new URL(match)

  let fileValue
  for (const [key, value] of url.searchParams) {
    if (key === 'file') {
      fileValue = value
      continue
    } else if (key === 'hls_chunk_host') {
      // Add the host parameter so some Invidious instances stop complaining about the missing host parameter
      // Replace .c.youtube.com with .googlevideo.com as the built-in Invidious video proxy only accepts host parameters with googlevideo.com
      url.pathname += `/host/${encodeURIComponent(value.replace('.c.youtube.com', '.googlevideo.com'))}`
    }

    url.pathname += `/${key}/${encodeURIComponent(value)}`
  }

  // This has to be right at the end so that shaka-player can read the file extension
  url.pathname += `/file/${encodeURIComponent(fileValue)}`

  url.search = ''
  return url.toString()
}

/** How far behind the newest segment live HLS playback sits, so a network hiccup drains buffer instead of stalling */
export const LIVE_HLS_HOLD_BACK_SECONDS = 30

/** YouTube keeps up to 12 hours of a live stream seekable */
const LIVE_HLS_MAX_HISTORY_SECONDS = 12 * 60 * 60

/** Placeholder host for the earlier segments, which the request filter swaps for the real segment URL */
const LIVE_HLS_HISTORY_HOST = 'ft-live-history.invalid'

const HLS_SEGMENT_SEQUENCE_REGEX = /\/sq\/(\d+)\//
const HLS_SEGMENT_ITAG_REGEX = /\/itag\/(\d+)\//
const HLS_SEGMENT_FILE_REGEX = /\/file\/[^/]+$/

/**
 * YouTube's live HLS media playlists only list the newest few segments, even though every earlier segment of the
 * stream can still be downloaded by changing the `/sq/` number in a segment URL. This lists the earlier segments
 * too, so shaka-player can seek back through the stream and start behind the live edge with a buffer to spare.
 *
 * The earlier segments get short placeholder URLs (see {@link resolveLiveHlsHistoryUri}), because the real ones
 * are about 1.7 KB each and hours of them would be megabytes. They are only listed in full the first time:
 * the playlist advertises delta updates (`CAN-SKIP-UNTIL`), so shaka-player asks with `_HLS_skip=YES` on every
 * refresh after that and gets an `EXT-X-SKIP` in place of the segments it was already given.
 * Segments that left YouTube's short playlist between two refreshes (a network outage, for example) were never
 * given, so a delta update lists those as placeholders after the skip, starting from the last segment that was
 * given. Skipping them too would leave a hole that shaka-player can't place the newer segments after.
 *
 * `EXT-X-PROGRAM-DATE-TIME` is dropped, so the segments are timed from the media sequence and their durations.
 * The newest segment's real URL is returned for the request filter to build the earlier segments' URLs from.
 * @param {string} playlist
 * @param {number | null} nextUnlistedSequence for a delta update (`_HLS_skip=YES`), the `nextSequence` returned
 * for the same itag last time; null for a full playlist
 * @param {number} [maxHistorySeconds]
 * @returns {{ playlist: string, itag: string, segmentUrl: string, nextSequence: number } | null}
 * null when the playlist can't be extended
 */
export function addLiveHlsHistory(playlist, nextUnlistedSequence, maxHistorySeconds = LIVE_HLS_MAX_HISTORY_SECONDS) {
  const lines = playlist.trim().split('\n')

  if (lines.some(line => /^#EXT-X-(?:ENDLIST|PLAYLIST-TYPE|SERVER-CONTROL|SKIP|PART|MAP|KEY)\b/.test(line))) {
    return null
  }

  const firstSegmentIndex = lines.findIndex(line => line.startsWith('#EXTINF:'))
  const mediaSequenceLine = lines.find(line => line.startsWith('#EXT-X-MEDIA-SEQUENCE:'))

  if (firstSegmentIndex === -1 || mediaSequenceLine === undefined) {
    return null
  }

  const mediaSequence = parseInt(mediaSequenceLine.slice('#EXT-X-MEDIA-SEQUENCE:'.length))
  const segmentDuration = parseFloat(lines[firstSegmentIndex].slice('#EXTINF:'.length))
  const firstSegmentUrl = lines[firstSegmentIndex + 1] ?? ''
  const segmentUrl = lines.findLast(line => !line.startsWith('#') && line.length > 0)

  const itag = segmentUrl.match(HLS_SEGMENT_ITAG_REGEX)?.[1]
  const fileSuffix = segmentUrl.match(HLS_SEGMENT_FILE_REGEX)?.[0]

  // Only extend playlists whose segment numbers line up with the media sequence, as YouTube's do
  if (
    isNaN(mediaSequence) || !(segmentDuration > 0) || itag === undefined || fileSuffix === undefined ||
    firstSegmentUrl.match(HLS_SEGMENT_SEQUENCE_REGEX)?.[1] !== String(mediaSequence)
  ) {
    return null
  }

  const historyStart = Math.max(0, mediaSequence - Math.floor(maxHistorySeconds / segmentDuration))

  const output = lines.slice(0, firstSegmentIndex)
    .filter(line => !line.startsWith('#EXT-X-MEDIA-SEQUENCE:') && !line.startsWith('#EXT-X-PROGRAM-DATE-TIME:'))

  output.push(
    `#EXT-X-MEDIA-SEQUENCE:${historyStart}`,
    `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=${maxHistorySeconds},HOLD-BACK=${LIVE_HLS_HOLD_BACK_SECONDS}`
  )

  // Everything before nextUnlistedSequence was listed in an earlier response, so shaka-player already has it.
  // The first segment after the skip must be one it already has: it anchors the new segments' times to it,
  // and for an unknown one it falls back to the start of the seek range, which wrecks the timeline.
  const firstPlaceholder = nextUnlistedSequence === null
    ? historyStart
    : Math.min(Math.max(nextUnlistedSequence - 1, historyStart), mediaSequence)

  if (firstPlaceholder > historyStart) {
    output.push(`#EXT-X-SKIP:SKIPPED-SEGMENTS=${firstPlaceholder - historyStart}`)
  }

  for (let sequence = firstPlaceholder; sequence < mediaSequence; sequence++) {
    output.push(
      `#EXTINF:${segmentDuration},`,
      `https://${LIVE_HLS_HISTORY_HOST}/itag/${itag}/sq/${sequence}${fileSuffix}`
    )
  }

  let segmentCount = 0
  for (let i = firstSegmentIndex; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      output.push(lines[i])
    }
    if (lines[i].startsWith('#EXTINF:')) {
      segmentCount++
    }
  }

  return {
    playlist: output.join('\n') + '\n',
    itag,
    segmentUrl,
    nextSequence: mediaSequence + segmentCount
  }
}

/**
 * Turns a placeholder URL from {@link addLiveHlsHistory} into the real segment URL,
 * using the newest real segment URL seen for the same itag.
 * @param {string} uri
 * @param {Map<string, string>} segmentUrlsByItag
 * @returns {string | null} null when the URI isn't a placeholder or there is no URL to build it from
 */
export function resolveLiveHlsHistoryUri(uri, segmentUrlsByItag) {
  if (!uri.startsWith(`https://${LIVE_HLS_HISTORY_HOST}/`)) {
    return null
  }

  const itag = uri.match(HLS_SEGMENT_ITAG_REGEX)?.[1]
  const sequence = uri.match(HLS_SEGMENT_SEQUENCE_REGEX)?.[1]
  const template = itag === undefined ? undefined : segmentUrlsByItag.get(itag)

  if (template === undefined || sequence === undefined) {
    return null
  }

  return template.replace(HLS_SEGMENT_SEQUENCE_REGEX, `/sq/${sequence}/`)
}

/**
 * @param {shaka.extern.xml.Node} adaptationSet
 */
function getCodecsPrefix(adaptationSet) {
  const codecs = adaptationSet.attributes.codecs ??
    adaptationSet.children
      .find(child => typeof child !== 'string' && child.tagName === 'Representation').attributes.codecs

  return codecs.split('.')[0]
}

/**
 * @param {shaka.extern.xml.Node[]} periods
 */
function sortAdapationSetsByCodec(periods) {
  const codecPriorities = [
    // audio
    'opus',
    'mp4a',
    'ec-3',
    'ac-3',

    // video
    'av01',
    'vp09',
    'vp9',
    'avc1'
  ]

  for (const period of periods) {
    period.children
      ?.sort((
        /** @type {shaka.extern.xml.Node | string} */ a,
        /** @type {shaka.extern.xml.Node | string} */ b
      ) => {
        if (typeof a === 'string' || a.tagName !== 'AdaptationSet' ||
          typeof b === 'string' || b.tagName !== 'AdaptationSet') {
          return 0
        }

        const typeA = a.attributes.contentType || a.attributes.mimeType.split('/')[0]
        const typeB = b.attributes.contentType || b.attributes.mimeType.split('/')[0]

        // always place image and text tracks AdaptionSets last in the manifest

        if (typeA !== 'video' && typeA !== 'audio') {
          return 1
        }
        if (typeB !== 'video' && typeB !== 'audio') {
          return -1
        }

        const codecsPrefixA = getCodecsPrefix(a)
        const codecsPrefixB = getCodecsPrefix(b)

        return codecPriorities.indexOf(codecsPrefixA) - codecPriorities.indexOf(codecsPrefixB)
      })
  }
}

/**
 * Sort audio AdaptationSets so that streams with higher bitrates come first.
 * Workaround that makes the player select high-quality audio.
 * @param {shaka.extern.xml.Node[]} periods
 */
function sortAudioAdaptationSetsByBitrate(periods) {
  for (const period of periods) {
    period.children
      ?.filter(child => typeof child !== 'string' && child.tagName === 'AdaptationSet' &&
        (child.attributes.contentType === 'audio' || child.attributes.mimeType.startsWith('audio/')))
      .forEach(adaptationSet => {
        adaptationSet.children.sort((a, b) => {
          if (a.tagName === 'AudioChannelConfiguration' && b.tagName !== 'AudioChannelConfiguration') {
            // Push AudioChannelConfiguration to the front (where it seems to already be) so that it doesn't
            // block sorting Representations if it's in the middle instead
            return -1
          } else if (b.tagName === 'AudioChannelConfiguration' && a.tagName !== 'AudioChannelConfiguration') {
            return 1
          } else if (a.tagName === 'Representation' && b.tagName === 'Representation') {
            return b.attributes.bandwidth - a.attributes.bandwidth
          } else {
            return 0
          }
        })
      })
  }
}

/**
 * @param {shaka.extern.xml.Node} mpdNode
 */
export function manifestPreprocessorTXml(mpdNode) {
  /** @type {shaka.extern.xml.Node[]} */
  const periods = mpdNode.children?.filter(child => typeof child !== 'string' && child.tagName === 'Period') ?? []

  sortAdapationSetsByCodec(periods)
  sortAudioAdaptationSetsByBitrate(periods)

  if (mpdNode.attributes.type === 'dynamic') {
    // fix live stream loading issues
    // YouTube uses a 12 second delay on the official website for normal streams
    // and a shorter one for low latency streams
    // If we don't add a little bit of a delay, we get presented with a loading symbol every 5 seconds,
    // while shaka-player processes the new manifest and segments
    const minimumUpdatePeriod = parseFloat(mpdNode.attributes.minimumUpdatePeriod.match(/^PT(\d+(?:\.\d+)?)S$/)[1])
    mpdNode.attributes.suggestedPresentationDelay = `PT${(minimumUpdatePeriod * 2).toFixed(3)}S`

    // fix live streams with subtitles having duplicate Representation ids
    // shaka-player throws DASH_DUPLICATE_REPRESENTATION_ID if we don't fix it

    for (const period of periods) {
      /** @type {shaka.extern.xml.Node[]} */
      const representations = []

      for (const periodChild of period.children) {
        if (typeof periodChild !== 'string' && periodChild.tagName === 'AdaptationSet') {
          for (const adaptationSetChild of periodChild.children) {
            if (typeof adaptationSetChild !== 'string' && adaptationSetChild.tagName === 'Representation') {
              representations.push(adaptationSetChild)
            }
          }
        }
      }

      const knownIds = new Set()
      let counter = 0
      for (const representation of representations) {
        const id = representation.attributes.id

        if (knownIds.has(id)) {
          const newId = `${id}-ft-fix-${counter}`

          representation.attributes.id = newId
          knownIds.add(newId)
          counter++
        } else {
          knownIds.add(id)
        }
      }
    }
  } else if (!process.env.SUPPORTS_LOCAL_API) {
    repairInvidiousManifest(periods)
  }
}

/** @type {shaka.extern.RequestFilter} */
export function requestFilter(type, request, _context) {
  if (type === RequestType.SEGMENT) {
    const url = new URL(request.uris[0])

    // only when we aren't proxying through Invidious,
    // it doesn't like the range param and makes get requests to youtube anyway
    if (url.protocol !== 'sabr:' && url.hostname.endsWith('.googlevideo.com') && url.pathname === '/videoplayback') {
      request.method = 'POST'
      request.body = new Uint8Array([0x78, 0]) // protobuf: { 15: 0 } (no idea what it means but this is what YouTube uses)

      if (request.headers.Range) {
        request.uris[0] += `&range=${request.headers.Range.split('=')[1]}`
        delete request.headers.Range
      }

      request.uris[0] += '&alr=yes'
    }
  }
}

export function stopPowerSaveBlocker() {
  if (process.env.IS_ELECTRON) {
    window.ftElectron.stopPowerSaveBlocker()
  }
}

// Each automatic SABR reload requests a new PO token and new player data from YouTube. When YouTube keeps
// refusing the tokens, more reloads don't help and the burst of requests can get the IP blocked (HTTP 403),
// so only a couple are allowed per video within the window.
const SABR_RELOAD_WINDOW_MS = 5 * 60_000
const MAX_SABR_RELOADS_PER_WINDOW = 2

/**
 * Decides whether an automatic SABR reload may go ahead, and returns the updated reload state.
 * The count resets for a different video or once the last reload is older than the window.
 * @param {{ videoId: string, count: number, lastReloadAt: number } | null} state
 * @param {string} videoId
 * @param {number} now
 * @returns {{ allowed: boolean, state: { videoId: string, count: number, lastReloadAt: number } }}
 */
export function registerSabrReload(state, videoId, now) {
  if (state?.videoId !== videoId || now - state.lastReloadAt > SABR_RELOAD_WINDOW_MS) {
    state = { videoId, count: 0, lastReloadAt: now }
  }

  if (state.count >= MAX_SABR_RELOADS_PER_WINDOW) {
    return { allowed: false, state }
  }

  return { allowed: true, state: { videoId, count: state.count + 1, lastReloadAt: now } }
}

/**
 * The time under the pointer on the seek bar, the way the bar maps positions to values.
 * @param {number} clientX
 * @param {{ left: number, width: number }} rect the range input's bounding rectangle
 * @param {number} min
 * @param {number} max
 * @returns {number} seconds, clamped to the bar's range
 */
export function getSeekBarTimeAtPosition(clientX, rect, min, max) {
  if (!(rect.width > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return Number.isFinite(min) ? min : 0
  }

  const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  return min + fraction * (max - min)
}

/**
 * @param {string} videoId
 * @param {number} seconds
 * @returns {string} the YouTube watch URL starting at that time, the same form the share menu copies
 */
export function buildTimestampedYouTubeUrl(videoId, seconds) {
  const time = Math.max(Math.floor(seconds), 0)
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  return time > 0 ? `${url}&t=${time}` : url
}

// A 403 from the video servers is usually short-lived: reloading the player (a new player response and fresh
// streaming URLs) plays on. Retrying in a tight loop is what turns it into a real IP block, so the retries back off
// and stop after a few per video within the window.
const FORBIDDEN_RETRY_WINDOW_MS = 10 * 60_000
const FORBIDDEN_RETRY_DELAYS_MS = [2_000, 6_000, 20_000]

/**
 * Decides whether the player may reload by itself after an HTTP 403, how long to wait first, and returns the
 * updated retry state. The count resets for a different video or once the last retry is older than the window.
 * @param {{ videoId: string, count: number, lastRetryAt: number } | null} state
 * @param {string} videoId
 * @param {number} now
 * @returns {{ allowed: boolean, delayMs: number, state: { videoId: string, count: number, lastRetryAt: number } }}
 */
export function registerForbiddenRetry(state, videoId, now) {
  if (state?.videoId !== videoId || now - state.lastRetryAt > FORBIDDEN_RETRY_WINDOW_MS) {
    state = { videoId, count: 0, lastRetryAt: now }
  }

  if (state.count >= FORBIDDEN_RETRY_DELAYS_MS.length) {
    return { allowed: false, delayMs: 0, state }
  }

  return {
    allowed: true,
    delayMs: FORBIDDEN_RETRY_DELAYS_MS[state.count],
    state: { videoId, count: state.count + 1, lastRetryAt: now }
  }
}

/**
 * @param {{ itag: number, lastModified: string, xtags?: string }} a
 * @param {{ itag: number, lastModified: string, xtags?: string }} b
 */
function isSameSabrFormat(a, b) {
  return a.itag === b.itag && a.lastModified === b.lastModified && (a.xtags || '') === (b.xtags || '')
}

/**
 * Builds the SABR data to swap into a playing stream from a fresh player response, or returns null when the
 * stream can't be refreshed in place. The player's manifest is built from the formats of the first response,
 * so every one of them has to still exist; otherwise only a full player reload picks up the new formats.
 * The client playback nonce (cpn) is kept, as the playback session carries on.
 * @param {import('../../views/Watch/Watch').SabrData} current
 * @param {{ itag: number, lastModified: string, xtags?: string }[]} currentFormats
 * @param {{
 *   streamingUrl?: string,
 *   ustreamerConfig?: string,
 *   poToken?: string,
 *   clientInfo: import('../../views/Watch/Watch').SabrData['clientInfo'],
 *   formats: { itag: number, lastModified: string, xtags?: string }[]
 * }} refreshed
 * @returns {import('../../views/Watch/Watch').SabrData | null}
 */
export function buildRefreshedSabrData(current, currentFormats, refreshed) {
  if (!refreshed.streamingUrl || !refreshed.ustreamerConfig || (current.poToken && !refreshed.poToken)) {
    return null
  }

  const allFormatsKept = currentFormats.every((format) => {
    return refreshed.formats.some(candidate => isSameSabrFormat(format, candidate))
  })

  if (!allFormatsKept) {
    return null
  }

  const url = new URL(refreshed.streamingUrl)
  url.searchParams.set('alr', 'yes')
  const cpn = new URL(current.url).searchParams.get('cpn')
  if (cpn) {
    url.searchParams.set('cpn', cpn)
  }

  return {
    url: url.toString(),
    poToken: refreshed.poToken,
    ustreamerConfig: refreshed.ustreamerConfig,
    clientInfo: refreshed.clientInfo,
  }
}
