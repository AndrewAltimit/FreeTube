import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'
import { formatDurationAsTimestamp } from '../../../helpers/utils'
import { getSeekBarTimeAtPosition } from '../../../helpers/player/utils'

/**
 * Context menu entry that copies the video's URL at a time: the time under the pointer when the menu was opened
 * on the seek bar, otherwise the current playback position. Hidden for live streams, which have no fixed timeline.
 */
/**
 * @param {EventTarget | null} target
 * @returns {HTMLInputElement | null} the seek bar's range input, when the target is on the seek bar
 */
function getSeekBarInput(target) {
  return target instanceof Element
    ? target.closest('.shaka-seek-bar-container')?.querySelector('input[type="range"]') ?? null
    : null
}

export class CopyTimestampUrlButton extends shaka.ui.Element {
  /**
   * @param {() => boolean} isLive
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(isLive, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('copy-timestamp-url-button')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_, PlayerIcons.LINK_DEFAULT)

    const label = document.createElement('label')
    label.classList.add('shaka-overflow-button-label', 'shaka-simple-overflow-button-label-inline')

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)
    this.button_.appendChild(label)

    this.parent.appendChild(this.button_)

    /** @private */
    this.time_ = 0

    /**
     * The seek bar time of a right-click that is being re-sent to the context menu
     * @private @type {number | null}
     */
    this.seekBarTime_ = null

    const controlsContainer = this.controls.getControlsContainer()

    // shaka's range inputs seek on a mousedown of any button and swallow `contextmenu`, so the context menu never
    // opens over the seek bar. These capture listeners run before the bar's own: a right-click doesn't seek, and its
    // `contextmenu` is re-sent from the controls container, where the context menu listens.
    this.eventManager.listen(controlsContainer, 'mousedown', (/** @type {MouseEvent} */ event) => {
      if (event.button !== 0 && getSeekBarInput(event.target)) {
        event.stopPropagation()
      }
    }, { capture: true })

    this.eventManager.listen(controlsContainer, 'contextmenu', (/** @type {MouseEvent} */ event) => {
      const seekBar = getSeekBarInput(event.target)
      if (!seekBar || isLive()) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      this.seekBarTime_ = getSeekBarTimeAtPosition(
        event.clientX,
        seekBar.getBoundingClientRect(),
        parseFloat(seekBar.min),
        parseFloat(seekBar.max)
      )
      controlsContainer.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
      }))
      this.seekBarTime_ = null
    }, { capture: true })

    // The context menu's own listener was added first, so by now it has decided to open; this only sets the label
    this.eventManager.listen(controlsContainer, 'contextmenu', () => {
      const live = isLive()
      // shaka.ui.Utils isn't exported from the compiled build, this is what its setDisplay does
      this.button_.classList.toggle('shaka-hidden', live)
      if (live) {
        return
      }

      this.time_ = this.seekBarTime_ ?? this.video?.currentTime ?? 0
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(this.button_, 'click', () => {
      events.dispatchEvent(new CustomEvent('copyTimestampUrl', { detail: Math.floor(this.time_) }))
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const label = i18n.global.t('Video.Player.Copy Video URL at Time', {
      time: formatDurationAsTimestamp(Math.floor(this.time_))
    })

    this.nameSpan_.textContent = label
    this.button_.ariaLabel = label
  }
}
