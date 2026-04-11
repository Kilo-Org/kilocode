/** @jsxImportSource solid-js */
import { Link, Style } from "@solidjs/meta"
import { For, Show } from "solid-js"
import inter from "../assets/fonts/inter.woff2"
import ibmPlexMonoBold from "../assets/fonts/ibm-plex-mono-bold.woff2"
import ibmPlexMonoMedium from "../assets/fonts/ibm-plex-mono-medium.woff2"
import ibmPlexMonoRegular from "../assets/fonts/ibm-plex-mono.woff2"
// kilocode_change start
import blexBold from "../assets/fonts/BlexMonoNerdFontMono-Bold.woff2"
import blexMedium from "../assets/fonts/BlexMonoNerdFontMono-Medium.woff2"
import blexRegular from "../assets/fonts/BlexMonoNerdFontMono-Regular.woff2"
import caskaydiaBold from "../assets/fonts/CaskaydiaCoveNerdFontMono-Bold.woff2"
import caskaydiaRegular from "../assets/fonts/CaskaydiaCoveNerdFontMono-Regular.woff2"
import firaBold from "../assets/fonts/FiraCodeNerdFontMono-Bold.woff2"
import firaRegular from "../assets/fonts/FiraCodeNerdFontMono-Regular.woff2"
import geistBold from "../assets/fonts/GeistMonoNerdFontMono-Bold.woff2"
import geistMedium from "../assets/fonts/GeistMonoNerdFontMono-Medium.woff2"
import geistRegular from "../assets/fonts/GeistMonoNerdFontMono-Regular.woff2"
import hackBold from "../assets/fonts/HackNerdFontMono-Bold.woff2"
import hackRegular from "../assets/fonts/HackNerdFontMono-Regular.woff2"
import inconsolataBold from "../assets/fonts/InconsolataNerdFontMono-Bold.woff2"
import inconsolataRegular from "../assets/fonts/InconsolataNerdFontMono-Regular.woff2"
import intoneBold from "../assets/fonts/IntoneMonoNerdFontMono-Bold.woff2"
import intoneRegular from "../assets/fonts/IntoneMonoNerdFontMono-Regular.woff2"
import iosevkaBold from "../assets/fonts/iosevka-nerd-font-bold.woff2"
import iosevkaRegular from "../assets/fonts/iosevka-nerd-font.woff2"
import jetbrainsBold from "../assets/fonts/JetBrainsMonoNerdFontMono-Bold.woff2"
import jetbrainsRegular from "../assets/fonts/JetBrainsMonoNerdFontMono-Regular.woff2"
import mesloBold from "../assets/fonts/MesloLGSNerdFontMono-Bold.woff2"
import mesloRegular from "../assets/fonts/MesloLGSNerdFontMono-Regular.woff2"
import robotoBold from "../assets/fonts/RobotoMonoNerdFontMono-Bold.woff2"
import robotoRegular from "../assets/fonts/RobotoMonoNerdFontMono-Regular.woff2"
import sauceBold from "../assets/fonts/SauceCodeProNerdFontMono-Bold.woff2"
import sauceRegular from "../assets/fonts/SauceCodeProNerdFontMono-Regular.woff2"
import ubuntuBold from "../assets/fonts/UbuntuMonoNerdFontMono-Bold.woff2"
import ubuntuRegular from "../assets/fonts/UbuntuMonoNerdFontMono-Regular.woff2"

export const MONO_NERD_FONTS = [
  { family: "BlexMono Nerd Font Mono", regular: blexRegular, medium: blexMedium, bold: blexBold },
  { family: "CaskaydiaCove Nerd Font Mono", regular: caskaydiaRegular, medium: undefined, bold: caskaydiaBold },
  { family: "FiraCode Nerd Font Mono", regular: firaRegular, medium: undefined, bold: firaBold },
  { family: "GeistMono Nerd Font Mono", regular: geistRegular, medium: geistMedium, bold: geistBold },
  { family: "Hack Nerd Font Mono", regular: hackRegular, medium: undefined, bold: hackBold },
  { family: "Inconsolata Nerd Font Mono", regular: inconsolataRegular, medium: undefined, bold: inconsolataBold },
  { family: "IntoneMono Nerd Font Mono", regular: intoneRegular, medium: undefined, bold: intoneBold },
  { family: "Iosevka Nerd Font", regular: iosevkaRegular, medium: undefined, bold: iosevkaBold },
  { family: "JetBrainsMono Nerd Font Mono", regular: jetbrainsRegular, medium: undefined, bold: jetbrainsBold },
  { family: "MesloLGS Nerd Font Mono", regular: mesloRegular, medium: undefined, bold: mesloBold },
  { family: "RobotoMono Nerd Font Mono", regular: robotoRegular, medium: undefined, bold: robotoBold },
  { family: "SauceCodePro Nerd Font Mono", regular: sauceRegular, medium: undefined, bold: sauceBold },
  { family: "UbuntuMono Nerd Font Mono", regular: ubuntuRegular, medium: undefined, bold: ubuntuBold },
] as const
// kilocode_change end

export const Font = () => {
  return (
    <>
      <Style>{`
        @font-face {
          font-family: "Inter";
          src: url("${inter}") format("woff2-variations");
          font-display: swap;
          font-style: normal;
          font-weight: 100 900;
        }
        @font-face {
          font-family: "Inter Fallback";
          src: local("Arial");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${ibmPlexMonoRegular}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 400;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${ibmPlexMonoMedium}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 500;
        }
        @font-face {
          font-family: "IBM Plex Mono";
          src: url("${ibmPlexMonoBold}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 700;
        }
        @font-face {
          font-family: "IBM Plex Mono Fallback";
          src: local("Courier New");
          size-adjust: 100%;
          ascent-override: 97%;
          descent-override: 25%;
          line-gap-override: 1%;
        }
        ${MONO_NERD_FONTS.map(
          (font) => `
        @font-face {
          font-family: "${font.family}";
          src: url("${font.regular}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 400;
        }
        ${
          font.medium
            ? `@font-face {
          font-family: "${font.family}";
          src: url("${font.medium}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 500;
        }`
            : ""
        }
        @font-face {
          font-family: "${font.family}";
          src: url("${font.bold}") format("woff2");
          font-display: swap;
          font-style: normal;
          font-weight: 700;
        }`,
        ).join("\n")}
      `}</Style>
      <Show when={typeof location === "undefined" || location.protocol !== "file:"}>
        <Link rel="preload" href={inter} as="font" type="font/woff2" crossorigin="anonymous" />
        <Link rel="preload" href={ibmPlexMonoRegular} as="font" type="font/woff2" crossorigin="anonymous" />
        {/* kilocode_change start */}
        <For each={MONO_NERD_FONTS}>
          {(font) => <Link rel="preload" href={font.regular} as="font" type="font/woff2" crossorigin="anonymous" />}
        </For>
        {/* kilocode_change end */}
      </Show>
    </>
  )
}
