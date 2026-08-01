# New UI Icon Palette

Canonical color palette used by New UI icons. When picking colors, always pull from this table; the IntelliJ icon engine recolors by exact-string match, so a one-off hue will fail to theme.

## How to read the mapping

- **Light** column is the color used in the default (light) SVG file: `foo.svg`.
- **Dark** column is its replacement in the `_dark` partner: `foo_dark.svg`.
- Always swap **all** light colors at once when generating the dark variant. Do not mix-and-match — the palette pairs are tuned for contrast.

## Neutrals (most icons need only these)

| Role | Light | Dark |
|---|---|---|
| **Primary stroke / fill** (main glyph) | `#6C707E` | `#CED0D6` |
| Secondary stroke (chevrons, faint glyph) | `#818594` | `#6F737A` |
| Tertiary stroke (very faint) | `#A8ADBD` | `#9DA0A8` |
| Disabled / inert fill background | `#EBECF0` | `#43454A` |
| Background plate (rare) | `#F0F1F2` | `#5A5D63` / `#1E1F22` |
| Plain white (status glyph only) | `white` | per-status muted (see below) |

`#6C707E` ↔ `#CED0D6` is the single most-used pair across the entire icon set. If you only remember one pair, remember this one.

## Accent — Blue (primary action, info, default node)

| Role | Light | Dark |
|---|---|---|
| Stroke / fill | `#3574F0` | `#548AF7` |
| Soft background fill (node circle) | `#E7EFFD` | `#25324D` |
| Tinted-panel fill | `#EDF3FF` | `#25324D` |
| Alt blue (rare) | `#4682FA` | `#5F93FF` |

## Accent — Red (delete, error nodes, breakpoints)

| Role | Light | Dark |
|---|---|---|
| Stroke / fill | `#DB3B4B` | `#DB5C5C` |
| Soft background fill | `#FFF7F7` | `#402929` |
| Status badge fill (error circle) | `#E55765` | `#DB5C5C` |

The slightly different `#DB3B4B` (line / accent) vs `#E55765` (badge fill) split is intentional — the filled status circle is a touch more saturated than the line accent.

## Accent — Green (run, success, version-control add)

| Role | Light | Dark |
|---|---|---|
| Stroke / fill | `#208A3C` | `#57965C` |
| Soft background fill | `#F2FCF3` | `#253627` |
| Status badge fill (success circle) | `#55A76A` | `#57965C` |
| Alt green (rare) | `#369650` | `#5FAD65` |

## Accent — Orange / Yellow (warning, modified, bookmark)

| Role | Light | Dark |
|---|---|---|
| Orange stroke / fill | `#E66D17` | `#C77D55` |
| Orange soft fill | `#FFF4EB` | `#45322B` |
| Warning yellow (status triangle) | `#FFAF0F` | `#F2C55C` |
| Warning soft fill | `#FFFAEB` / `#F7E4CD` | `#3D3223` |
| Brown / gold deep | `#C27D04` | `#D6AE58` |
| Muted dark glyph inside warning fill | n/a (uses `white`) | `#5E4D33` |

The "white on yellow" combination is illegible in Dark theme; that's why the dark warning glyph uses `#5E4D33` (a deep brown). Apply the same idea — muted-dark glyph inside the warm fill — for any other warm-color badge in the dark theme.

## Accent — Purple (annotations, special / preview)

| Role | Light | Dark |
|---|---|---|
| Stroke / fill | `#834DF0` | `#B589EC` |
| Soft background fill | `#FAF5FF` | `#2F2936` |
| Alt purple (rare) | n/a | `#A571E6` |

## Reserved / utility

| Role | Light/Dark |
|---|---|
| Inside-circle glyph (light status) | `white` |
| Empty / placeholder | `#231F20` (avoid) |
| Tool window panel base (very rare) | `#1E1F22` (dark) |
| Other repository-specific tints | only when a sibling icon already uses them |

If your icon needs a color that is not in this table, find a sibling icon that uses something similar and reuse its exact hex string. If no sibling uses it, change your design — do not introduce a new color.

## Algorithmic light→dark swap (for scripted generation)

```text
#6C707E -> #CED0D6   primary stroke/fill
#818594 -> #6F737A   secondary stroke
#A8ADBD -> #9DA0A8   tertiary stroke
#EBECF0 -> #43454A   disabled fill

#3574F0 -> #548AF7   blue
#EDF3FF -> #25324D   blue soft
#E7EFFD -> #25324D   blue node fill

#DB3B4B -> #DB5C5C   red
#FFF7F7 -> #402929   red soft
#E55765 -> #DB5C5C   error badge fill

#208A3C -> #57965C   green
#55A76A -> #57965C   success badge fill
#F2FCF3 -> #253627   green soft
#369650 -> #5FAD65   alt green

#E66D17 -> #C77D55   orange
#FFF4EB -> #45322B   orange soft
#FFAF0F -> #F2C55C   warning yellow
#FFFAEB -> #3D3223   warning soft
#F7E4CD -> #3D3223   warning soft alt
#C27D04 -> #D6AE58   gold

#834DF0 -> #B589EC   purple
#FAF5FF -> #2F2936   purple soft

white   -> (status-glyph specific muted dark — see Orange/Yellow section)
```

A script can do a literal find-and-replace using this map to produce a `_dark.svg` from a light SVG; review the result manually for any white-on-warm cases that need the muted-dark glyph treatment.
