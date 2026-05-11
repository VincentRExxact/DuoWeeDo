library(shiny)
library(shinyMobile)
library(tools)

# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE LOADER
#  Copies ALL images from images/ into www/current/ once at startup so Shiny
#  can serve them as static assets. Returns a list of relative URLs.
# ══════════════════════════════════════════════════════════════════════════════

prepare_images <- function(img_dir = "images") {
  files <- list.files(img_dir, full.names = TRUE)
  files <- files[tolower(file_ext(files)) %in% c("jpg", "jpeg", "png")]
  if (length(files) == 0) return(NULL)

  out_dir <- file.path("www", "current")
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

  urls <- vapply(files, function(f) {
    dest <- file.path(out_dir, basename(f))
    file.copy(f, dest, overwrite = TRUE)
    paste0("current/", basename(f))
  }, character(1))

  unname(urls)
}

# ══════════════════════════════════════════════════════════════════════════════
#  UI
#  Minimal: just a button to open the PhotoBrowser.
#  The canvas is injected as a fixed overlay by JS (events.js) — it sits on
#  top of the PhotoBrowser's full-screen view at z-index 9999.
# ══════════════════════════════════════════════════════════════════════════════

ui <- f7Page(
  title   = "Tile Selector",
  options = list(theme = "auto", dark = "auto", color = "#6dcea0"),

  tags$head(
    tags$style(HTML("
      /* Fixed canvas overlay — positioned above the PhotoBrowser (z-index ~13000) */
      #grid-canvas {
        position: fixed;
        top: 0; left: 0;
        width: 100vw; height: 100svh;
        z-index: 13500;
        pointer-events: none;   /* start disabled; events.js enables on open */
        touch-action: none;
        display: none;          /* hidden until PhotoBrowser opens */
      }
    ")),
    tags$script(src = "www/grid.js"),
    tags$script(src = "www/events.js")
  ),

  # Canvas lives at document root — outside the PhotoBrowser DOM — so it
  # reliably overlays regardless of Framework7's internal z-index stack.
  tags$canvas(id = "grid-canvas"),

  f7SingleLayout(
    navbar = f7Navbar(title = "Tile Selector"),

    f7Block(
      f7Button(
        inputId = "open_browser",
        label   = "Open images",
        color   = "teal"
      )
    )
  )
)

# ══════════════════════════════════════════════════════════════════════════════
#  SERVER
# ══════════════════════════════════════════════════════════════════════════════

server <- function(input, output, session) {

  # Prepare all images once at startup
  all_urls   <- prepare_images()
  sel_tiles  <- reactiveVal(list())
  # Track which image is currently displayed (index into all_urls)
  current_idx <- reactiveVal(1L)

  if (is.null(all_urls)) {
    f7Toast(session, text = "No images found in images/ folder.", position = "bottom")
  }

  # ── Build photos list for f7PhotoBrowser ────────────────────────────────────
  # NOTE: f7PhotoBrowser requires at least 2 photos (known shinyMobile bug).
  # If only 1 image exists, we duplicate it to satisfy this constraint.
  make_photos <- function(urls) {
    if (length(urls) == 1) urls <- c(urls, urls)
    lapply(urls, function(u) list(url = u))
  }

  # ── Open PhotoBrowser when button is clicked ────────────────────────────────
  observeEvent(input$open_browser, {
    req(all_urls)
    f7PhotoBrowser(
      id     = "photo_browser",
      theme  = "dark",
      type   = "standalone",    # full-screen, no back button chrome
      photos = make_photos(all_urls)
    )
    # Tell JS to show and size the canvas overlay
    session$sendCustomMessage("browser_opened", list(
      urls = all_urls,
      idx  = current_idx() - 1L   # 0-based for JS
    ))
  })

  # ── PhotoBrowser swipe → new image index reported by JS ────────────────────
  # events.js fires 'photo_index_changed' with the new 0-based index
  observeEvent(input$photo_index_changed, {
    new_idx <- as.integer(input$photo_index_changed) + 1L
    current_idx(new_idx)
    sel_tiles(list())   # clear selection on image change
  })

  # ── PhotoBrowser closed → hide canvas ──────────────────────────────────────
  observeEvent(input$browser_closed, {
    session$sendCustomMessage("browser_closed", list())
  })

  # ── Tile selection from JS ──────────────────────────────────────────────────
  observeEvent(input$selected_tiles, {
    tiles <- input$selected_tiles
    if (is.null(tiles)) return()

    result <- if (is.data.frame(tiles)) {
      lapply(seq_len(nrow(tiles)), function(i)
        list(row = tiles$row[i], col = tiles$col[i]))
    } else {
      tiles
    }
    sel_tiles(result)

    # ── Persistence hook ─────────────────────────────────────────────────────
    # Uncomment when ready:
    # df <- data.frame(
    #   timestamp  = Sys.time(),
    #   image_name = basename(all_urls[current_idx()]),
    #   row        = sapply(result, `[[`, "row"),
    #   col        = sapply(result, `[[`, "col")
    # )
    # mongolite::mongo("tiles", url = Sys.getenv("MONGO_URL"))$insert(df)
  })
}

shinyApp(ui, server)
