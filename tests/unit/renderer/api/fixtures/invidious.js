// Handcrafted, trimmed Invidious API (v1) response objects.
// Only the fields FreeTube's Invidious helpers read or rewrite are included.

export const INSTANCE = 'https://invidious.example'

/** @param {object} overrides */
export function invidiousVideo(overrides = {}) {
  return {
    type: 'video',
    title: 'A video',
    videoId: 'aaaaaaaaaaa',
    author: 'Some Channel',
    authorId: 'UCchannel000000000000000',
    authorUrl: '/channel/UCchannel000000000000000',
    videoThumbnails: [{ quality: 'medium', url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', width: 320, height: 180 }],
    viewCount: 1234,
    lengthSeconds: 62,
    // Invidious sends unix seconds
    published: 1700000000,
    publishedText: '2 days ago',
    premiereTimestamp: 0,
    liveNow: false,
    isUpcoming: false,
    ...overrides,
  }
}

export function invidiousComment(overrides = {}) {
  return {
    commentId: 'Ugcomment',
    authorId: 'UCcommenter',
    author: '@commenter',
    authorThumbnail: 'https://yt3.ggpht.com/abc=s48',
    authorIsChannelOwner: false,
    isSponsor: false,
    likeCount: 5,
    isPinned: false,
    contentHtml: 'see https://example.com and <img src="/ggpht/emoji.png">',
    published: 1700000000,
    ...overrides,
  }
}

export function invidiousCommunityPost(overrides = {}) {
  return {
    commentId: 'UgkxPost',
    author: 'Some Channel',
    authorId: 'UCchannel000000000000000',
    authorThumbnails: [{ url: 'https://yt3.ggpht.com/avatar=s88', width: 88, height: 88 }],
    contentHtml: 'Hello <a href="/watch?v=aaaaaaaaaaa">link</a>',
    publishedText: '3 days ago',
    likeCount: 10,
    replyCount: 4,
    attachment: null,
    ...overrides,
  }
}

/** Trimmed adaptiveFormats entries */
export const ADAPTIVE_AUDIO = {
  init: '0-258',
  index: '259-900',
  bitrate: '130000',
  url: 'https://rr1.googlevideo.com/videoplayback?itag=251&dur=212.061&xtags=acont%3Ddubbed%3Alang%3Dde',
  itag: '251',
  type: 'audio/webm; codecs="opus"',
  audioQuality: 'AUDIO_QUALITY_MEDIUM',
  audioSampleRate: 48000,
  audioChannels: 2,
}

export const ADAPTIVE_VIDEO = {
  init: '0-219',
  index: '220-700',
  bitrate: '2000000',
  url: 'https://rr1.googlevideo.com/videoplayback?itag=136&dur=212.040',
  itag: '136',
  type: 'video/mp4; codecs="avc1.4d401f"',
  width: 1280,
  height: 720,
  fps: 30,
  qualityLabel: '720p',
}

export const LEGACY_FORMAT = {
  url: 'https://rr1.googlevideo.com/videoplayback?itag=18',
  itag: '18',
  type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
  quality: 'medium',
  bitrate: '503000',
  fps: 30,
  qualityLabel: '360p',
  size: '640x360',
}
