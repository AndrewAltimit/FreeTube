// Handcrafted, heavily trimmed InnerTube renderer JSON.
// Tests feed these through youtubei.js' Parser so the local API helpers see
// real YTNode instances (with their getters), not hand-rolled mocks.

import { Parser } from 'youtubei.js'

export const CHANNEL_ID = 'UCchannel000000000000000'

export function parse(raw) {
  return Parser.parseItem(raw)
}

export function runs(text, endpoint = undefined) {
  return { runs: [{ text, ...(endpoint ? { navigationEndpoint: endpoint } : {}) }] }
}

export function simple(text) {
  return { simpleText: text }
}

export function browseEndpoint(browseId, url = `/channel/${browseId}`, pageType = 'WEB_PAGE_TYPE_CHANNEL') {
  return {
    commandMetadata: { webCommandMetadata: { url, webPageType: pageType } },
    browseEndpoint: { browseId },
  }
}

export function thumbnails(url = 'https://i.ytimg.com/vi/x/hq.jpg') {
  return { thumbnails: [{ url, width: 480, height: 360 }] }
}

function timeStatusOverlay(text, style = 'DEFAULT') {
  return { thumbnailOverlayTimeStatusRenderer: { text: simple(text), style } }
}

/** search / channel videos tab item */
export function videoRenderer({
  videoId = 'video000001',
  title = 'Video title',
  length = '1:02:03',
  views = '1,234,567 views',
  shortViews,
  published = '2 days ago',
  upcomingStart,
  badges = [],
  overlayStyle = 'DEFAULT',
  owner = { name: 'Some Channel', id: CHANNEL_ID },
  noTimeOverlay = false,
} = {}) {
  return {
    videoRenderer: {
      videoId,
      title: runs(title),
      thumbnail: thumbnails(),
      ...(length ? { lengthText: simple(length) } : {}),
      ...(views != null ? { viewCountText: simple(views) } : {}),
      ...(shortViews != null ? { shortViewCountText: simple(shortViews) } : {}),
      ...(published ? { publishedTimeText: simple(published) } : {}),
      ...(upcomingStart ? { upcomingEventData: { startTime: String(upcomingStart) } } : {}),
      ownerText: owner ? runs(owner.name, browseEndpoint(owner.id)) : undefined,
      badges: badges.map(([label, style = 'BADGE_STYLE_TYPE_SIMPLE']) => ({ metadataBadgeRenderer: { label, style } })),
      thumbnailOverlays: noTimeOverlay ? [] : [timeStatusOverlay(length ?? 'LIVE', overlayStyle)],
    },
  }
}

export function gridVideoRenderer({ videoId = 'grid0000001', length = '4:05', published = '3 weeks ago', views = '12,345 views', author } = {}) {
  return {
    gridVideoRenderer: {
      videoId,
      title: simple('Grid video'),
      thumbnail: thumbnails(),
      ...(published ? { publishedTimeText: simple(published) } : {}),
      viewCountText: simple(views),
      ...(author ? { shortBylineText: runs(author.name, browseEndpoint(author.id)) } : {}),
      thumbnailOverlays: [timeStatusOverlay(length, length === 'LIVE' ? 'LIVE' : 'DEFAULT')],
    },
  }
}

export function reelItemRenderer({ videoId = 'short000001', title = ' Short title ', views = '1.2M views' } = {}) {
  return {
    reelItemRenderer: {
      videoId,
      headline: simple(title),
      thumbnail: thumbnails(),
      ...(views ? { viewCountText: simple(views) } : {}),
      navigationEndpoint: { reelWatchEndpoint: { videoId } },
    },
  }
}

export function shortsLockupViewModel({ videoId = 'short000002', title = 'Lockup short', views = '35K views', accessibilityText } = {}) {
  return {
    shortsLockupViewModel: {
      entityId: `shorts-shelf-item-${videoId}`,
      accessibilityText: accessibilityText ?? `${title}, ${views} - play Short`,
      onTap: { innertubeCommand: { reelWatchEndpoint: { videoId } } },
      overlayMetadata: {
        primaryText: { content: title },
        ...(views ? { secondaryText: { content: views } } : {}),
      },
    },
  }
}

export function playlistRenderer({ playlistId = 'PLplaylist', title = 'A playlist', count = '1,234', owner, shortByline, overlays = [] } = {}) {
  return {
    playlistRenderer: {
      playlistId,
      title: simple(title),
      thumbnails: [thumbnails('https://i.ytimg.com/vi/p/hq.jpg')],
      videoCountText: runs(`${count} videos`),
      thumbnailText: runs(`${count} videos`),
      ...(owner ? { longBylineText: runs(owner.name, browseEndpoint(owner.id)) } : {}),
      ...(shortByline ? { shortBylineText: simple(shortByline) } : {}),
      thumbnailOverlays: overlays.map(iconType => ({ thumbnailOverlayBottomPanelRenderer: { icon: { iconType } } })),
      navigationEndpoint: { watchEndpoint: { playlistId } },
    },
  }
}

export function gridPlaylistRenderer({ playlistId = 'PLgrid', count = '15', music = false } = {}) {
  return {
    gridPlaylistRenderer: {
      playlistId,
      title: simple('Grid playlist'),
      thumbnail: thumbnails('https://i.ytimg.com/vi/g/hq.jpg'),
      thumbnailText: runs(`${count} videos`),
      shortBylineText: runs('Some Channel', browseEndpoint(CHANNEL_ID)),
      thumbnailOverlays: music ? [{ thumbnailOverlayBottomPanelRenderer: { icon: { iconType: 'MUSIC' } } }] : [],
      navigationEndpoint: { watchEndpoint: { playlistId } },
    },
  }
}

export function playlistVideoRenderer({ videoId = 'plvideo0001', info, lengthSeconds = '125', style = 'DEFAULT', upcomingStart, author = { name: 'Uploader', id: 'UCuploader' } } = {}) {
  return {
    playlistVideoRenderer: {
      videoId,
      index: simple('1'),
      title: { runs: [{ text: 'Playlist video' }], accessibility: { accessibilityData: { label: 'Playlist video' } } },
      shortBylineText: runs(author.name, browseEndpoint(author.id)),
      thumbnail: thumbnails(),
      thumbnailOverlays: [timeStatusOverlay('2:05', style)],
      navigationEndpoint: { watchEndpoint: { videoId } },
      videoInfo: info ?? { runs: [{ text: '5.3K views' }, { text: ' • ' }, { text: '1 year ago' }] },
      ...(lengthSeconds ? { lengthSeconds } : {}),
      ...(upcomingStart ? { upcomingEventData: { startTime: String(upcomingStart) } } : {}),
    },
  }
}

function attributed(content, onTap = undefined) {
  return {
    content,
    ...(onTap ? { commandRuns: [{ startIndex: 0, length: content.length, onTap: { innertubeCommand: onTap } }] } : {}),
  }
}

/**
 * @param {{
 *   contentId?: string,
 *   contentType?: string,
 *   title?: string,
 *   rows?: ({ text: string, endpoint?: object }[])[],
 *   rowBadges?: string[],
 *   bottomBadges?: { text?: string, badgeStyle?: string, icon?: string }[],
 *   avatarChannelId?: string
 * }} options
 */
export function lockupVideo({ contentId = 'lockup00001', contentType = 'LOCKUP_CONTENT_TYPE_VIDEO', title = 'Lockup video', rows = [], rowBadges = [], bottomBadges = [{ text: '10:01' }], avatarChannelId } = {}) {
  return {
    lockupViewModel: {
      contentId,
      contentType,
      contentImage: {
        thumbnailViewModel: {
          image: { sources: [{ url: 'https://i.ytimg.com/vi/l/hq.jpg', width: 480, height: 270 }] },
          overlays: [{
            thumbnailBottomOverlayViewModel: {
              badges: bottomBadges.map(({ text, badgeStyle, icon }) => ({
                thumbnailBadgeViewModel: {
                  text,
                  badgeStyle,
                  ...(icon ? { icon: { sources: [{ clientResource: { imageName: icon } }] } } : {}),
                },
              })),
            },
          }],
        },
      },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: title },
          ...(avatarChannelId
            ? {
                image: {
                  decoratedAvatarViewModel: {
                    avatar: { avatarViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/a', width: 68, height: 68 }] } } },
                    rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: avatarChannelId } } } } },
                  },
                },
              }
            : {}),
          metadata: {
            contentMetadataViewModel: {
              metadataRows: rows.map((parts, i) => ({
                metadataParts: parts.map(({ text, endpoint }) => ({ text: attributed(text, endpoint) })),
                ...(i === 0 && rowBadges.length > 0 ? { badges: rowBadges.map(style => ({ badgeViewModel: { badgeText: 'Members only', badgeStyle: style } })) } : {}),
              })),
            },
          },
        },
      },
    },
  }
}

export function lockupPlaylist({ contentId = 'PLlockup', contentType = 'LOCKUP_CONTENT_TYPE_PLAYLIST', count = '42 videos', channel, badgeIcon } = {}) {
  return {
    lockupViewModel: {
      contentId,
      contentType,
      contentImage: {
        collectionThumbnailViewModel: {
          primaryThumbnail: {
            thumbnailViewModel: {
              image: { sources: [{ url: 'https://i.ytimg.com/vi/pl/hq.jpg', width: 480, height: 270 }] },
              overlays: [{
                thumbnailOverlayBadgeViewModel: {
                  thumbnailBadges: [{
                    thumbnailBadgeViewModel: {
                      text: count,
                      ...(badgeIcon ? { icon: { sources: [{ clientResource: { imageName: badgeIcon } }] } } : {}),
                    },
                  }],
                },
              }],
            },
          },
        },
      },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: 'Lockup playlist' },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: channel
                ? [{ metadataParts: [{ text: attributed(channel.name, { ...browseEndpoint(channel.id) }) }] }]
                : [],
            },
          },
        },
      },
    },
  }
}

export function channelRenderer({ handle = '@somechannel', subs = '1.5M subscribers', videos } = {}) {
  return {
    channelRenderer: {
      channelId: CHANNEL_ID,
      title: simple('Some Channel'),
      navigationEndpoint: browseEndpoint(CHANNEL_ID, '/@somechannel'),
      thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/avatar=s88', width: 88, height: 88 }] },
      // the "new" layout puts the handle in subscriberCountText and subscribers in videoCountText
      subscriberCountText: simple(handle ?? subs),
      videoCountText: simple(handle ? subs : videos),
      descriptionSnippet: runs('About this channel'),
    },
  }
}

export function backstagePostRenderer({ postId = 'UgkxPost', content = runs('Hello world'), votes = '1.2K', replies, attachment } = {}) {
  return {
    backstagePostRenderer: {
      postId,
      authorText: runs('Some Channel'),
      authorEndpoint: browseEndpoint(CHANNEL_ID),
      authorThumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/avatar=s88', width: 88, height: 88 }] },
      contentText: content,
      publishedTimeText: runs('1 day ago'),
      ...(votes ? { voteCount: simple(votes) } : {}),
      ...(replies ? { actionButtons: { commentActionButtonsRenderer: { replyButton: { buttonRenderer: { text: simple(replies) } } } } } : {}),
      ...(attachment ? { backstageAttachment: attachment } : {}),
    },
  }
}
