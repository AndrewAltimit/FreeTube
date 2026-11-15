<p align="center">
 <img alt="" src="/_icons/logoColor.svg" width=500 align="center">
</p>

FreeTube is an open source desktop YouTube player built with privacy in mind.
Use YouTube without advertisements and prevent Google from tracking you with their cookies and JavaScript.
Available for Windows (10 and later), Mac (macOS 13 and later) & Linux thanks to Electron.

> [!IMPORTANT]
> **This is a single-maintainer fork of [FreeTubeApp/FreeTube](https://github.com/FreeTubeApp/FreeTube).** It is not affiliated with or endorsed by the FreeTube team.
>
> Upstream moves slowly and some bugs have been open for a long time (for example, the subscription reload issues). This fork uses AI-assisted workflows (Claude Code, under human direction) to fix them directly. All code changes here are AI-authored.
>
> - **No external contributions are accepted.** Pull requests from outside parties are closed without review. See [CONTRIBUTING.md](CONTRIBUTING.md).
> - **No feature requests or support.**
> - **Do not report this fork's bugs upstream.** The FreeTube team does not support this fork.
>
> The rest of this README is upstream's, adjusted where it conflicts with this fork. For official builds and support, use [upstream FreeTube](https://github.com/FreeTubeApp/FreeTube).

<p align="center"><a href="https://github.com/FreeTubeApp/FreeTube/releases">Download upstream FreeTube</a></p>
<p align="center">
  <a href="https://hosted.weblate.org/engage/free-tube/">
    <img src="https://hosted.weblate.org/widgets/free-tube/-/svg-badge.svg" alt="Translation status" />
  </a>
</p>

<hr>
<p align="center"><a href="#screenshots">Screenshots</a> &bull; <a href="#how-does-it-work">How does it work?</a> &bull; <a href="#features">Features</a> &bull; <a href="#download-links">Download Links</a> &bull; <a href="#contributing">Contributing</a> &bull; <a href="#localization">Localization</a> &bull; <a href="#contact">Contact</a> &bull; <a href="#donate">Donate</a> &bull; <a href="#license">License</a></p>
<p align="center"><a href="https://freetubeapp.io/">Website</a> &bull; <a href="https://docs.freetubeapp.io/">Documentation</a> &bull; <a href="https://docs.freetubeapp.io/faq/">FAQ</a> &bull; <a href="https://github.com/FreeTubeApp/FreeTube/discussions">Discussions</a></p>
<hr>

> [!NOTE] 
> FreeTube is currently in Beta. While it should work well for most users, there are still bugs and missing features that need to be addressed.

## Screenshots
| The main FreeTube window                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube1.png)|

| Watching a video                                                                                 |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube2.png)|

| Settings                                                                                         |
|--------------------------------------------------------------------------------------------------|
| ![](https://raw.githubusercontent.com/FreeTubeApp/FreeTubeApp.io/master/src/images/FreeTube3.png)|

## How does it work?
FreeTube uses a built in extractor to grab and serve data / videos. The [Invidious API](https://github.com/iv-org/invidious) can also optionally be used. FreeTube does not use any official APIs to obtain data. While YouTube can still see your video requests, it can no
longer track you using cookies or JavaScript. Your subscriptions, playlists and history are stored locally on your computer and never sent out.

> [!IMPORTANT]  
> Using a VPN or Tor is highly recommended to hide your IP while using FreeTube.

## Features
* Watch videos without ads
* Use YouTube without Google tracking you using cookies and JavaScript
* Two extractor APIs to choose from (Built in or Invidious)
* Subscribe to channels without an account
* Connect to an externally setup proxy such as Tor
* View and search your local subscriptions, playlists and history
* Organize your subscriptions into "Profiles" to create a more focused feed
* Export & import subscriptions
* YouTube Trending
* YouTube Chapters
* Most popular videos page based on the set Invidious instance
* SponsorBlock
* DeArrow
* Open videos from your browser directly into FreeTube (with extension)
* Watch videos using an external player
* Full Theme support
* Make a screenshot of a video
* Multiple windows
* Mini Player (Picture-in-Picture)
* Keyboard shortcuts
* Option to show only family friendly content
* Show/hide functionality or elements within the app using the distraction free settings
* View channel posts

### Browser Extensions
The following extensions open YouTube links directly in FreeTube:

- [LibRedirect](https://libredirect.manerakai.com/)
- [RedirectTube](https://github.com/MStankiewiczOfficial/RedirectTube)

LibRedirect automatically redirect YouTube links to FreeTube.
> [!IMPORTANT]
> To ensure proper functionality, select FreeTube as Frontend in the Services settings of the extension.

RedirectTube, doesn’t automatically open YouTube links in FreeTube (although this feature can be enabled in the settings). Instead, it adds buttons to the toolbar and context menu, which you can click to open videos in FreeTube manually.

- Download LibRedirect from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/libredirect/) (for Firefox based-browsers) or [developer's website](https://libredirect.manerakai.com/download_chromium.html) (for Chrome and Chromium-based browsers).

- Download RedirectTube from [Mozilla Add-ons](https://addons.mozilla.org/firefox/addon/redirecttube/) (for Firefox based-browsers) or [Chrome Web Store](https://chromewebstore.google.com/detail/redirecttube/jpbaggklodpddjcadlebabhiopjkjfjh) (for Chrome and Chromium-based browsers).

> [!NOTE]
> These extensions do not work on Linux portable builds!
>
> If you have issues with the extension working with FreeTube, please create an issue in this repository instead of the extension repository.

## Download Links
### Official Downloads

> [!CAUTION]
> FreeTube is only supported on Windows 10 and later, macOS 13 and above, and various Linux distributions. Installing it on unsupported systems may result in unexpected issues.

* [GitHub Releases](https://github.com/FreeTubeApp/FreeTube/releases)

* [FreeTube Website](https://freetubeapp.io/#download)

* Flatpak on Flathub: [Download](https://flathub.org/apps/details/io.freetubeapp.FreeTube) and [Source Code](https://github.com/flathub/io.freetubeapp.FreeTube)

#### This fork's builds
This fork has no CI or release builds yet. The upstream pipelines are disabled while CI is rebuilt on a self-hosted runner (see [`.github/workflows-disabled/`](.github/workflows-disabled/README.md)). Until then, build from source with `pnpm install && pnpm run build`.

### Projects maintained by individual FreeTube team members
* Homebrew FreeTube (Apple Silicon only): [Install](https://github.com/PikachuEXE/homebrew-FreeTube)

* FreeTubeAndroid (FreeTube port for Android and PWA): [Download](https://github.com/MarmadileManteater/FreeTubeAndroid/releases) and [Source Code](https://github.com/MarmadileManteater/FreeTubeAndroid)

> [!IMPORTANT]
> These projects are related to FreeTube and are maintained by individual members of the FreeTube team. While they are not part of the main FreeTube project, they may be useful to FreeTube users. There may be issues when using these projects compared to the official builds. Any issues specific to these builds should be reported to their respective maintainers. Make sure you always try an [official download](https://github.com/freetubeapp/freetube/#official-downloads) before reporting your issue to us!

## Contributing
This fork does not accept external contributions; see [CONTRIBUTING.md](CONTRIBUTING.md). Development happens on `main`, with feature branches off it.

Thank you very much to the [People and Projects](https://docs.freetubeapp.io/credits/) that make FreeTube possible, and to the upstream FreeTube team, whose work this fork builds on.

## Localization
Translations come from upstream FreeTube's Weblate project and are pulled in when this fork syncs with upstream. To help translate, contribute there:

<a href="https://hosted.weblate.org/engage/free-tube/">
<img src="https://hosted.weblate.org/widgets/free-tube/-/287x66-grey.png" alt="Translation status" />
</a>

We are actively looking for translations!  We use [Weblate](https://hosted.weblate.org/engage/free-tube/) to make it easy for translators to get involved.  Click on the badge above to learn how to get involved.

For the Linux Flatpak, the desktop entry comment string can be translated at our [Flatpak repository](https://github.com/flathub/io.freetubeapp.FreeTube/blob/master/io.freetubeapp.FreeTube.desktop).

## Contact
This fork offers no support channel. The contact and donation details below belong to upstream FreeTube and are for upstream only.

If you ever have any questions about upstream FreeTube, feel free to ask it on their [Discussions](https://github.com/FreeTubeApp/FreeTube/discussions) page.  Alternatively, you can join our [Matrix Space](https://matrix.to/#/#freetubeapp:matrix.org).  

> [!IMPORTANT]
> Don't forget to check out the [rules](https://docs.freetubeapp.io/community/matrix/) before joining.

## Donate
If you enjoy using FreeTube, you're welcome to leave a donation using the following method.  

* Bitcoin Address: `1Lih7Ho5gnxb1CwPD4o59ss78pwo2T91eS`

While your donations are much appreciated, only donate if you really want to.  Donations are used for keeping the website up and running and eventual code signing costs. 

> [!TIP]
> If you are using the Invidious API then we recommend that you donate to the instance that you use. You can also donate to the [Invidious team](https://invidious.io/donate/) or the [Local API developer](https://github.com/sponsors/LuanRT).

## License
[![GNU AGPLv3 Image](https://www.gnu.org/graphics/agplv3-155x51.png)](https://www.gnu.org/licenses/agpl-3.0.html)  

FreeTube is Free Software: You can use, study share and improve it at your
will. Specifically you can redistribute and/or modify it under the terms of the
[GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.html) as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.  
