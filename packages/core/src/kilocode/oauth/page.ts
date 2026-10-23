export * as KiloOauthCallbackPage from "./page.js"

/**
 * The Kilo Code mark. The Kilo host gives it to `OauthCallbackPage.brand` through `App.Product`, so the OAuth
 * callback pages show it in place of the OpenCode wordmark.
 */
export const wordmark = `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" aria-label="Kilo Code" role="img">
        <path fill="currentColor" d="M0 0v100h100V0H0Zm92.592 92.592H7.407V7.407h85.185v85.185ZM61.111 71.91h9.259v7.407H58.73l-5.026-5.027V62.65h7.407v9.26Zm16.667 0H70.37v-9.26h-9.259v-7.407h11.64l5.027 5.026V71.91ZM46.296 61.111H38.89v-7.407h7.407v7.407ZM22.222 53.704h7.408V70.37h16.666v7.408H27.249l-5.027-5.027V53.704Zm55.556-14.815v7.407H53.704V38.89h8.278V29.63h-8.278v-7.408h10.659l5.026 5.027v11.64h8.389ZM29.63 30.556h9.259l7.407 7.407v8.333H38.89v-8.333H29.63v8.333h-7.408V22.222h7.408v8.334Zm16.666 0H38.89v-8.334h7.407v8.334Z" />
      </svg>`
