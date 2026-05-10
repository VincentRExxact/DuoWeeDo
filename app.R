library(shiny)
library(shinyMobile)
library(png)
library(jpeg)
library(tools)
library(mongolite)
library(tidyverse)



# ══════════════════════════════════════════════════════════════════════════════
#  CONNECT TO MONGODB
# ══════════════════════════════════════════════════════════════════════════════
logDB<-function(){
  Connection = mongo(collection="Connection", db="DuoWeeDo", url=Sys.getenv("MONGO_URL"))
  return(Connection)
}

Connection_db<-logDB()


session_token<-ifelse(exists("session"),session$token,"test_token")

Temp<-tibble(date= Sys.time(),session=session_token)

Connection_db$insert(Temp)


# ══════════════════════════════════════════════════════════════════════════════
#  CONSTANTS
# ══════════════════════════════════════════════════════════════════════════════

G           <- 8L      # grid size — 8×8, hard-coded
TOP_MARGIN  <- 0.22    # perspective: fraction inset on each side at the top

# ══════════════════════════════════════════════════════════════════════════════
#  GEOMETRY  (pure R)
# ══════════════════════════════════════════════════════════════════════════════

bilerp <- function(tl, tr, bl, br, u, v) {
  list(
    x = (1-u)*(1-v)*tl$x + u*(1-v)*tr$x + (1-u)*v*bl$x + u*v*br$x,
    y = (1-u)*(1-v)*tl$y + u*(1-v)*tr$y + (1-u)*v*bl$y + u*v*br$y
  )
}

trap_corners <- function() {
  list(
    tl = list(x = TOP_MARGIN,     y = 1),
    tr = list(x = 1 - TOP_MARGIN, y = 1),
    bl = list(x = 0,              y = 0),
    br = list(x = 1,              y = 0)
  )
}

tile_corners <- function(r, c) {
  co <- trap_corners()
  u0 <- c / G;       u1 <- (c + 1) / G
  vt <- (G - r) / G; vb <- (G - 1 - r) / G
  list(
    tl = bilerp(co$tl, co$tr, co$bl, co$br, u0, vt),
    tr = bilerp(co$tl, co$tr, co$bl, co$br, u1, vt),
    br = bilerp(co$tl, co$tr, co$bl, co$br, u1, vb),
    bl = bilerp(co$tl, co$tr, co$bl, co$br, u0, vb)
  )
}

point_in_quad <- function(px, py, corners) {
  pts <- list(corners$tl, corners$tr, corners$br, corners$bl)
  for (i in 1:4) {
    a     <- pts[[i]]
    b     <- pts[[(i %% 4) + 1]]
    cross <- (b$x - a$x) * (py - a$y) - (b$y - a$y) * (px - a$x)
    if (cross < 0) return(FALSE)
  }
  TRUE
}

hit_tile <- function(px, py) {
  for (r in 0:(G-1))
    for (c in 0:(G-1))
      if (point_in_quad(px, py, tile_corners(r, c)))
        return(list(row = r + 1L, col = c + 1L))
  NULL
}

# ══════════════════════════════════════════════════════════════════════════════
#  DRAWING  (base R graphics)
# ══════════════════════════════════════════════════════════════════════════════

draw_grid <- function(raster_img, selected) {
  
  co <- trap_corners()
  
  par(mar = c(0, 0, 0, 0))
  plot.new()
  plot.window(xlim = c(0, 1), ylim = c(0, 1))
  
  # Draw the cached raster — no disk I/O here
  rasterImage(raster_img, 0, 0, 1, 1, interpolate = TRUE)
  
  # Selected tile fills
  for (tile in selected) {
    pts <- tile_corners(tile$row - 1L, tile$col - 1L)
    polygon(
      c(pts$tl$x, pts$tr$x, pts$br$x, pts$bl$x),
      c(pts$tl$y, pts$tr$y, pts$br$y, pts$bl$y),
      col    = adjustcolor("#6dcea0", alpha.f = 0.35),
      border = "#6dcea0",
      lwd    = 2
    )
  }
  
  # Horizontal grid lines
  for (ri in 0:G) {
    v  <- ri / G
    xs <- sapply(0:G, function(ci) bilerp(co$tl, co$tr, co$bl, co$br, ci/G, v)$x)
    ys <- sapply(0:G, function(ci) bilerp(co$tl, co$tr, co$bl, co$br, ci/G, v)$y)
    lines(xs, ys, col = "#50c882", lwd = 1.4)
  }
  
  # Vertical grid lines
  for (ci in 0:G) {
    u  <- ci / G
    xs <- sapply(0:G, function(ri) bilerp(co$tl, co$tr, co$bl, co$br, u, ri/G)$x)
    ys <- sapply(0:G, function(ri) bilerp(co$tl, co$tr, co$bl, co$br, u, ri/G)$y)
    lines(xs, ys, col = "#50c882", lwd = 1.4)
  }
}
  

# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE LOADER
# ══════════════════════════════════════════════════════════════════════════════


load_random_raster <- function(img_dir = "images") {
  files <- list.files(img_dir, full.names = TRUE)
  files <- files[tolower(file_ext(files)) %in% c("jpg", "jpeg", "png")]
  if (length(files) == 0) return(NULL)
  path <- sample(files, 1)
  ext  <- tolower(file_ext(path))
  switch(ext,
         png  = png::readPNG(path),
         jpg  = ,
         jpeg = jpeg::readJPEG(path)
  )
}

# ══════════════════════════════════════════════════════════════════════════════
#  UI
#  www/swipe.js is auto-served by Shiny from the www/ folder.
#  It fires 'swipe_left' and 'swipe_right' Shiny inputs — nothing else.
# ══════════════════════════════════════════════════════════════════════════════

ui <- f7Page(
  title   = "DuoWeeDo",
  allowPWA = FALSE,
  options = list(theme = "auto", dark = FALSE, color = "#6dcea0"),
  
  tags$head(
    tags$script(src = "swipe.js")   # loaded from www/swipe.js
  ),
  
f7SingleLayout(
    navbar = f7Navbar(
      title = "DuoWeeDo"
    ),
    
    # main content
    f7Card(
      title = "Green On Brown",
      plotOutput(
        outputId = "grid_plot",
        click    = clickOpts(id = "plot_click", clip = TRUE)
      )
    )
  )
)

# ══════════════════════════════════════════════════════════════════════════════
#  SERVER
# ══════════════════════════════════════════════════════════════════════════════

server <- function(input, output, session) {
  
  cached_raster <- reactiveVal(load_random_raster())
  sel_tiles   <- reactiveVal(list())
  
  
  # ── Swipe left → new random image + clear selection ────────────────────────
  observeEvent(input$swipe_left, {
    new_raster <- load_random_raster()
    if (!is.null(new_raster)) {
      cached_raster(new_raster)
      sel_tiles(list())
    }
  })
  
  # ── Swipe right → clear selection only ────────────────────────────────────
  observeEvent(input$swipe_right, {
    sel_tiles(list())
  })
  
  
  # Click → hit-test in R → toggle tile
  observeEvent(input$plot_click, {
    click <- input$plot_click
    if (is.null(click)) return()
    if (click$x < 0 || click$x > 1 || click$y < 0 || click$y > 1) return()
    
    hit <- hit_tile(click$x, click$y)
    if (is.null(hit)) return()
    
    tiles   <- sel_tiles()
    already <- vapply(tiles, function(t) t$row == hit$row && t$col == hit$col, logical(1))
    sel_tiles(if (any(already)) tiles[!already] else c(tiles, list(hit)))
  })
  
  # Render image + overlaid grid
  output$grid_plot <- renderPlot({
    raster <- cached_raster()
    if (is.null(raster)) {
      plot.new()
      text(0.5, 0.5, "Put images in images/ folder", cex = 1.4, col = "grey60")
      return()
    }
    # Only sel_tiles() changes on click — raster is already in memory
    draw_grid(raster, sel_tiles())
  },
  res           = 96,
  execOnResize  = FALSE    # FIX 3 — no re-render on window resize = no extra blanks
  )
}

shinyApp(ui, server)
