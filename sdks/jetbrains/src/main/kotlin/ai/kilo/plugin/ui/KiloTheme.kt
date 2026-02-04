package ai.kilo.plugin.ui

import com.intellij.ui.JBColor
import com.intellij.util.ui.JBUI
import java.awt.Color

/**
 * Centralized theme constants matching the web client design system.
 * Uses JBColor for automatic light/dark mode switching.
 * 
 * Color values are derived from packages/ui/src/styles/theme.css and colors.css
 */
object KiloTheme {
    // ============ BACKGROUND COLORS ============
    // Main app backgrounds
    val backgroundBase = JBColor(0xF8F7F7, 0x131010)
    val backgroundStronger = JBColor(0xFCFCFC, 0x191515)
    val backgroundWeak = JBColor(0xF1F0F0, 0x1B1818)
    val backgroundStrong = JBColor(0xFDFCFC, 0x151313)
    
    // Surface colors (for cards, panels, elevated elements)
    val surfaceRaisedBase = JBColor(0xFDFCFC, 0x252121)
    val surfaceRaisedStrong = JBColor(0xFFFFFF, 0x2D2828)
    val surfaceInsetBase = JBColor(0xF1F0F0, 0x1B1818)
    val surfaceInteractive = JBColor(0xEAF2FF, 0x0C2255)
    val surfaceInteractiveHover = JBColor(0xE5F0FF, 0x0A1D4D)
    val surfaceSuccess = JBColor(0xE1FADE, 0x152D13)
    val surfaceSuccessWeak = JBColor(0xF4FCF3, 0x121B11)
    val surfaceWarning = JBColor(0xFFF6BE, 0x2A2307)
    val surfaceWarningWeak = JBColor(0xFFFBEA, 0x1B180F)
    val surfaceCritical = JBColor(0xFFE9E4, 0x3C140D)
    val surfaceCriticalWeak = JBColor(0xFFF6F3, 0x201412)
    val surfaceInfo = JBColor(0xFCEAFD, 0x2F1E31)
    
    // ============ TEXT COLORS ============
    val textBase = JBColor(0x656363, 0xB7B1B1)
    val textWeak = JBColor(0x8E8B8B, 0x716C6B)
    val textWeaker = JBColor(0xBCBBBB, 0x4B4646)
    val textStrong = JBColor(0x211E1E, 0xF1ECEC)
    val textInteractive = JBColor(0x1251EC, 0x89B5FF)
    val textOnInteractive = JBColor(0xFDFCFC, 0xF1ECEC)
    val textSuccess = JBColor(0x008600, 0x37DB2E)
    val textOnSuccess = JBColor(0x008600, 0x37DB2E)
    val textWarning = JBColor(0x917500, 0xFDD63C)
    val textOnWarning = JBColor(0x4E2009, 0xFEF3DD)
    val textCritical = JBColor(0xDA3319, 0xFF917B)
    val textOnCritical = JBColor(0xDA3319, 0xFF917B)
    val textDiffAdd = JBColor(0x318430, 0x9DDE99)
    val textDiffDelete = JBColor(0xDA3319, 0xFF917B)
    
    // ============ BORDER COLORS ============
    val borderBase = JBColor(0xCFCECD, 0x4B4646)
    val borderWeak = JBColor(0xE2E0E0, 0x3E3939)
    val borderWeaker = JBColor(0xE9E8E8, 0x343030)
    val borderStrong = JBColor(0xBCBBBB, 0x645F5F)
    val borderInteractive = JBColor(0x98BFFF, 0x204CB1)
    val borderInteractiveSelected = JBColor(0x034CFF, 0x034CFF)
    val borderSuccess = JBColor(0x9FE598, 0x1D5B19)
    val borderWarning = JBColor(0xF2D775, 0x514307)
    val borderCritical = JBColor(0xFFA392, 0x742216)
    val borderInfo = JBColor(0xE3A9E7, 0x573859)
    
    // ============ ICON COLORS ============
    val iconBase = JBColor(0x8E8B8B, 0x716C6B)
    val iconWeak = JBColor(0xCFCECD, 0x3E3939)
    val iconStrong = JBColor(0x211E1E, 0xF1ECEC)
    val iconSuccess = JBColor(0x7DD676, 0x226C1E)
    val iconSuccessActive = JBColor(0x008600, 0x37DB2E)
    val iconWarning = JBColor(0xF3BA63, 0x693F05)
    val iconWarningActive = JBColor(0xAD5700, 0xF1A10D)
    val iconCritical = JBColor(0xEF442A, 0xFC533A)
    val iconCriticalActive = JBColor(0xDA3319, 0xFF917B)
    val iconInteractive = JBColor(0x034CFF, 0x89B5FF)
    val iconInfo = JBColor(0xD78BDD, 0x6C486E)
    
    // ============ BUTTON COLORS ============
    val buttonPrimaryBg = JBColor(0x211E1E, 0xF1ECEC)
    val buttonPrimaryFg = JBColor(0xFDFCFC, 0x131010)
    val buttonSecondaryBg = JBColor(0xFDFCFC, 0x231F1F)
    val buttonSecondaryBgHover = JBColor(0xFAF9F9, 0x2A2727)
    val buttonSecondaryFg = textBase
    val buttonGhostHover = JBColor(0xF1F0F0, 0x252121)
    
    // ============ SYNTAX/CODE COLORS ============
    val syntaxComment = textWeak
    val syntaxString = JBColor(0x006656, 0x00CEB9)
    val syntaxKeyword = textWeak
    val syntaxPrimitive = JBColor(0xFB4804, 0xFFBA92)
    val syntaxOperator = textBase
    val syntaxVariable = textStrong
    val syntaxProperty = JBColor(0xED6DC8, 0xFF9AE2)
    val syntaxType = JBColor(0x596600, 0xECF58C)
    val syntaxConstant = JBColor(0x007B80, 0x93E9F6)
    val syntaxPunctuation = textBase
    
    // ============ DIFF COLORS ============
    val diffAddBg = JBColor(0xDAFBE0, 0x1A2A19)
    val diffAddBgWeak = JBColor(0xF4FCF3, 0x1F3A1E)
    val diffAddText = JBColor(0x318430, 0x9DDE99)
    val diffAddTextStrong = JBColor(0x1F461D, 0xC4FBC0)
    val diffDeleteBg = JBColor(0xFFE9E4, 0x3C140D)
    val diffDeleteBgWeak = JBColor(0xFFF6F3, 0x530E05)
    val diffDeleteText = JBColor(0xDA3319, 0xFF917B)
    val diffDeleteTextStrong = JBColor(0x5C281F, 0xFFD1C8)
    
    // ============ AGENT COLORS ============
    // Each agent has a distinctive color for borders/accents
    val agentCode = iconInteractive  // Blue - cobalt
    val agentAsk = JBColor(0x0894B3, 0x51A8FF)  // Cyan
    val agentPlan = JBColor(0x8445BC, 0xDCA2E0)  // Purple - lilac
    val agentDocs = JBColor(0xEE9D2B, 0xF1A10D)  // Amber/Orange
    val agentBuild = JBColor(0x034CFF, 0x89B5FF)  // Blue - cobalt
    
    /**
     * Get agent color by name.
     */
    fun getAgentColor(agent: String?): Color {
        return when (agent?.lowercase()) {
            "code" -> agentCode
            "ask" -> agentAsk
            "plan" -> agentPlan
            "docs" -> agentDocs
            "build" -> agentBuild
            else -> agentCode  // Default to code agent color
        }
    }
    
    // ============ MARKDOWN COLORS ============
    val markdownHeading = JBColor(0xD68C27, 0x9D7CD8)
    val markdownText = JBColor(0x1A1A1A, 0xEEEEEE)
    val markdownLink = JBColor(0x3B7DD8, 0xFAB283)
    val markdownLinkText = JBColor(0x318795, 0x56B6C2)
    val markdownCode = JBColor(0x3D9A57, 0x7FD88F)
    val markdownBlockQuote = JBColor(0xB0851F, 0xE5C07B)
    val markdownEmph = JBColor(0xB0851F, 0xE5C07B)
    val markdownStrong = JBColor(0xD68C27, 0xF5A742)
}

/**
 * Spacing constants matching the web client design system.
 * Base unit is 4px (0.25rem).
 */
object KiloSpacing {
    val xxs = JBUI.scale(2)    // 2px
    val xs = JBUI.scale(4)     // 4px - base spacing unit
    val sm = JBUI.scale(6)     // 6px
    val md = JBUI.scale(8)     // 8px
    val lg = JBUI.scale(12)    // 12px
    val xl = JBUI.scale(16)    // 16px
    val xxl = JBUI.scale(18)   // 18px - message gap in web client
    val xxxl = JBUI.scale(24)  // 24px
    val xxxxl = JBUI.scale(32) // 32px - collapsible content gap
}

/**
 * Typography constants matching the web client design system.
 */
object KiloTypography {
    const val fontSizeXSmall = 11f
    const val fontSizeSmall = 12f
    const val fontSizeBase = 13f   // --font-size-small in web
    const val fontSizeMedium = 14f // --font-size-base in web
    const val fontSizeLarge = 16f  // --font-size-large in web
    const val fontSizeXLarge = 20f // --font-size-x-large in web
    
    const val fontWeightRegular = 400
    const val fontWeightMedium = 500
}

/**
 * Border radius constants matching the web client design system.
 */
object KiloRadius {
    val xs = JBUI.scale(2)  // 0.125rem - 2px
    val sm = JBUI.scale(4)  // 0.25rem - 4px (most common)
    val md = JBUI.scale(6)  // 0.375rem - 6px
    val lg = JBUI.scale(8)  // 0.5rem - 8px
    val xl = JBUI.scale(10) // 0.625rem - 10px
}

/**
 * Container/size constants matching the web client design system.
 */
object KiloSizes {
    // Icon sizes
    val iconXs = JBUI.scale(12)
    val iconSm = JBUI.scale(14)
    val iconMd = JBUI.scale(16)
    val iconLg = JBUI.scale(20)
    val iconXl = JBUI.scale(24)
    
    // Button sizes
    val buttonHeight = JBUI.scale(28)
    val buttonHeightSm = JBUI.scale(24)
    val buttonHeightLg = JBUI.scale(32)
    
    // Session list cell height
    val sessionCellHeight = JBUI.scale(24)
    
    // Sidebar width
    val sidebarWidth = JBUI.scale(240)
    
    // Message header height (matching web client)
    val messageHeaderHeight = JBUI.scale(32)
    
    // Accordion content max height
    val accordionMaxHeight = JBUI.scale(240)
    
    // User message collapsed height
    val userMessageCollapsedHeight = JBUI.scale(64)
}
