<template>
  <div>
    <FtCard class="card">
      <h2>
        <FontAwesomeIcon
          :icon="['fas', 'info-circle']"
          class="headingIcon"
        />
        {{ $t("About.About") }}
      </h2>
      <section class="brand">
        <FtLogoFull class="logo" />
        <div class="version">
          {{ versionNumber }}
        </div>
      </section>
      <section class="about-chunks">
        <figure
          v-for="chunk in chunks"
          :key="chunk.title"
          class="chunk"
        >
          <FontAwesomeIcon
            class="icon"
            :icon="chunk.icon"
          />
          <h3 class="title">
            {{ chunk.title }}
          </h3>
          <div
            v-safer-html="chunk.content"
            class="content"
          />
        </figure>
      </section>
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtLogoFull from '../../components/FtLogoFull/FtLogoFull.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import { RELEASES_PAGE_URL, REPOSITORY_URL } from '../../helpers/updates.js'
import packageDetails from '../../../../package.json'

const { t } = useI18n()

const versionNumber = `v${packageDetails.version}`

const chunks = computed(() => [
  {
    icon: ['fab', 'github'],
    title: t('About.Source code'),
    content: [
      `<a href="${REPOSITORY_URL}" lang="en" dir="ltr">GitHub: AndrewAltimit/FreeTube</a>`,
      t('About.Licensed under the {licenseLink}', {
        licenseLink: `<a href="https://www.gnu.org/licenses/agpl-3.0.en.html">${t('About.AGPLv3')}</a>`,
      }),
    ].join('<br>'),
  },
  {
    icon: ['fas', 'file-download'],
    title: t('About.Downloads / Changelog'),
    content: `<a href="${RELEASES_PAGE_URL}">${t('About.GitHub releases')}</a>`,
  },
  {
    icon: ['fas', 'question-circle'],
    title: t('About.Help'),
    content: [
      `<a href="https://docs.freetubeapp.io/">${t('About.FreeTube Wiki')}</a>`,
      `<a href="https://docs.freetubeapp.io/faq/">${t('About.FAQ')}</a>`,
    ].join(' / '),
  },
  {
    icon: ['fas', 'users'],
    title: t('About.Credits'),
    content: t('About.FreeTube is made possible by {creditsPageLink}', {
      creditsPageLink: `<a href="https://docs.freetubeapp.io/credits/">${t('About.these people and projects')}</a>`,
    }),
  },
])
</script>

<style scoped src="./About.css" />
