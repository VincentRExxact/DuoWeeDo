library(shiny)
library(shinyMobile)
library(tools)

# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE LOADER
#  Copies all images from images/ into www/current/ at startup so Shiny
#  serves them as static assets accessible by f7PhotoBrowser.
# ══════════════════════════════════════════════════════════════════════════════

prepare_images <- function(img_dir = "images") {
  files <- list.files(img_dir, full.names = TRUE)
  files <- files[tolower(file_ext(files)) %in% c("jpg", "jpeg", "png")]
  if (length(files) == 0) return(NULL)

  out_dir <- file.path("www", "current")
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

  unname(vapply(files, function(f) {
    file.copy(f, file.path(out_dir, basename(f)), overwrite = TRUE)
    paste0("current/", basename(f))
  }, character(1)))
}

# ══════════════════════════════════════════════════════════════════════════════
#  UI
#  Only events.js is loaded — it imports grid.js internally via its own
#  responsibilities. No canvas in the page markup.
# ══════════════════════════════════════════════════════════════════════════════

ui <- f7Page(
  title   = "Tile Selector",
  options = list(theme = "auto", dark = "auto", color = "#6dcea0"),

  tags$head(
    tags$script(src = "grid.js"),     # grid first — defines functions events.js calls
    tags$script(src = "events.js")    # events second — wires everything together
  ),

  f7SingleLayout(
    navbar = f7Navbar(title = "Tile Selector"),
    f7Block(
      f7Button(inputId = "open_browser", label = "Open images", color = "teal")
    )
  )
)

# ══════════════════════════════════════════════════════════════════════════════
#  SERVER
#  R responsibilities:
#    1. Prepare images and open the PhotoBrowser
#    2. Listen to JS events: slide change, browser closed, tile selection
#    3. Persist tile selections (hook ready for MongoDB / Google Sheets)
# ══════════════════════════════════════════════════════════════════════════════

server <- function(input, output, session) {

  all_urls    <- prepare_images()
  sel_tiles   <- reactiveVal(list())
  current_idx <- reactiveVal(1L)

  if (is.null(all_urls))
    f7Toast(session, text = "No images found in images/ folder.", position = "bottom")

  # f7PhotoBrowser requires >= 2 photos (known shinyMobile constraint)
  make_photos <- function(urls) {
    if (length(urls) == 1) urls <- c(urls, urls)
    lapply(urls, function(u) list(url = u))
  }

  # ── 1. Open PhotoBrowser then signal JS to attach the grid canvas ──────────
  observeEvent(input$open_browser, {
    req(all_urls)
    f7PhotoBrowser(
      id     = "photo_browser",
      theme  = "dark",
      type   = "standalone",
      photos = make_photos(all_urls)
    )
    session$sendCustomMessage("browser_opened", list())
  })

  # ── 2a. Slide changed — JS reports new 0-based index ──────────────────────
  observeEvent(input$photo_index_changed, {
    current_idx(as.integer(input$photo_index_changed) + 1L)
    sel_tiles(list())
  })

  # ── 2b. PhotoBrowser closed ────────────────────────────────────────────────
  observeEvent(input$browser_closed, {
    sel_tiles(list())
  })

  # ── 2c. Tile selection updated by JS (1-based row/col) ────────────────────
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

    # ── 3. Persistence hook ────────────────────────────────────────────────────
    # Uncomment and configure when ready:
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
