<template>
  <div
    class="floatingRefreshSection"
  >
    <p
      v-if="lastRefreshTimestamp"
      class="lastRefreshTimestamp"
    >
      {{ t('Feed.Feed Last Updated', { feedName: title, date: lastRefreshTimestamp }) }}
    </p>
    <FtIconButton
      :disabled="disableRefresh || refreshing"
      :icon="['fas', 'sync']"
      class="refreshButton"
      :class="{ refreshing }"
      :aria-busy="refreshing"
      :title="refreshing ? t('Feed.Refreshing Feed', { subscriptionName: title }) : refreshFeedButtonTitle"
      :size="12"
      theme="primary"
      @click="click"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../FtIconButton/FtIconButton.vue'

import { KeyboardShortcuts } from '../../../constants'
import { addKeyboardShortcutToActionTitle } from '../../helpers/utils'

const props = defineProps({
  disableRefresh: {
    type: Boolean,
    default: false
  },
  /** A refresh is in progress: the icon spins and the button is disabled until it finishes */
  refreshing: {
    type: Boolean,
    default: false
  },
  lastRefreshTimestamp: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

const refreshFeedButtonTitle = computed(() => {
  return addKeyboardShortcutToActionTitle(
    t('Feed.Refresh Feed', { subscriptionName: props.title }),
    KeyboardShortcuts.APP.SITUATIONAL.REFRESH
  )
})

const emit = defineEmits(['click'])

function click() {
  emit('click')
}
</script>

<style scoped lang="scss" src="./FtRefreshWidget.scss" />
