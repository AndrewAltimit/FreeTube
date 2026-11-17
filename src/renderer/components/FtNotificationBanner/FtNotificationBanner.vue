<template>
  <div
    class="ftNotificationBanner"
    tabindex="0"
    role="link"
    :title="message"
    :aria-describedby="id"
    @click="handleClick"
    @keydown.enter.space.prevent="handleClick"
  >
    <p
      :id="id"
      class="message"
    >
      {{ message }}
    </p>
    <button
      v-if="actionLabel"
      class="actionButton"
      :disabled="actionDisabled"
      @click.stop="emit('action')"
      @keydown.enter.space.stop
    >
      {{ actionLabel }}
    </button>
    <button
      class="closeButton"
      :aria-label="$t('Close Banner')"
      :title="$t('Close Banner')"
      @click.stop="handleClose"
      @keydown.enter.space.stop
    >
      <FontAwesomeIcon
        class="closeIcon"
        :icon="['fas', 'times']"
      />
    </button>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useId } from 'vue'

defineProps({
  message: {
    type: String,
    required: true
  },
  /** Shows a button beside the message that emits `action` */
  actionLabel: {
    type: String,
    default: ''
  },
  actionDisabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'action'])

const id = useId()

function handleClick() {
  emit('click', true)
}

function handleClose() {
  emit('click', false)
}
</script>

<style scoped src="./FtNotificationBanner.css" />
