# Tile Selector — shinyMobile PWA

## Architecture

```
app.R          ← single file, pure R, no CSS, no JS
images/        ← put your images here (jpg, jpeg, png)
```

No `www/` folder needed — CSS and JS are gone entirely.

## How it works

| Concern | Mechanism |
|---|---|
| UI / theming | `shinyMobile` — auto iOS / Android theme via `theme = "auto"` |
| Click capture | `plotOutput(click = clickOpts(...))` — native Shiny, no JS |
| Tile hit-test | `hit_tile()` — pure R bilinear interpolation + cross-product test |
| Grid drawing | `draw_grid()` — base R `rasterImage()` + `polygon()` + `lines()` |
| Perspective | `trap_corners(top_margin)` — controlled by the Perspective stepper |

## Install dependencies

```r
install.packages(c("shiny", "shinyMobile", "png", "jpeg", "tools"))
```

## Run

```r
shiny::runApp("app.R")
```

## PWA deployment (shinyapps.io / Posit Connect)

shinyMobile automatically injects the PWA manifest and service worker.
On iOS: Safari → Share → "Add to Home Screen"
On Android: Chrome → menu → "Add to Home Screen"

## Grid geometry

The trapezoid is defined by 4 corners in plot-space [0,1]×[0,1]:

```
Top:    (margin, 1) ────── (1-margin, 1)   ← narrow
Bottom: (0,      0) ────── (1,        0)   ← full width
```

Every tile corner is computed by bilinear interpolation of these 4 points.
Click (x,y) from Shiny is tested against each tile quad using the
cross-product sign method — all in R, zero JavaScript.
