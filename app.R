library(shiny)
library(shinyMobile)
library(tools)

# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE LOADER  — copies all images to www/current/ once at startup
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
# ══════════════════════════════════════════════════════════════════════════════

ui <- f7Page(
  title   = "Tile Selector",
  options = list(theme = "auto", dark = FALSE, color = "#6dcea0"),
  
  tags$head(
    tags$style(HTML("
      /* img-wrap fills everything below the navbar */
      #img-wrap {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* Image: natural size, centred, never overflows */
      #bg-image {
        display: block;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        transform-origin: center center;
        user-select: none;
        -webkit-user-drag: none;
      }
      /* Canvas: absolute, injected once by grid.js, sized to the img */
      #grid-canvas {
        position: absolute;
        top: 0; left: 0;
        pointer-events: none;   /* grid.js enables when ready */
        touch-action: none;
        z-index: 10;
      }
    ")),
    tags$script(src = "grid.js"),
    tags$script(src = "events.js")
  ),
  
  f7SingleLayout(
    navbar = f7Navbar(
      title = "DuoWeeDo"
    ),
    
   
    
    
    # Static DOM — always in the page, no lifecycle management needed
    tags$div(
      id = "img-wrap",
      tags$img(id = "bg-image", src = "", alt = ""),
      tags$canvas(id = "grid-canvas")
    ),
    
    toolbar=f7Toolbar(
      position = "bottom",
      f7Button(icon = f7Icon("arrow_left"), inputId = "nav_prev"),
      tags$div(style = "flex:1"),
      f7Button(icon = f7Icon("arrow_right"), inputId = "nav_next")
    ),
  )
)

# ══════════════════════════════════════════════════════════════════════════════
#  SERVER
# ══════════════════════════════════════════════════════════════════════════════

server <- function(input, output, session) {
  
  all_urls    <- prepare_images()
  sel_tiles   <- reactiveVal(list())
  current_idx <- reactiveVal(1L)
  
  if (is.null(all_urls))
    f7Toast(session, text = "No images in images/ folder.", position = "bottom")
  
  # ── Push image URL to JS ───────────────────────────────────────────────────
  push_image <- function(idx) {
    session$sendCustomMessage("set_image", list(
      url   = all_urls[[idx]],
      index = idx,
      total = length(all_urls)
    ))
    sel_tiles(list())
  }
  
  # ── Load first image once JS is ready ─────────────────────────────────────
  observe({
    req(all_urls)
    push_image(current_idx())
  })
  
  # ── Navbar prev button ─────────────────────────────────────────────────────
  observeEvent(input$nav_prev, {
    req(all_urls)
    idx <- max(1L, current_idx() - 1L)
    current_idx(idx)
    push_image(idx)
  })
  
  # ── Navbar next button ─────────────────────────────────────────────────────
  observeEvent(input$nav_next, {
    req(all_urls)
    idx <- min(length(all_urls), current_idx() + 1L)
    current_idx(idx)
    push_image(idx)
  })
  
  # ── Swipe left (next) from events.js ──────────────────────────────────────
  observeEvent(input$swipe_next, {
    req(all_urls)
    idx <- min(length(all_urls), current_idx() + 1L)
    current_idx(idx)
    push_image(idx)
  })
  
  # ── Swipe right (prev) from events.js ─────────────────────────────────────
  observeEvent(input$swipe_prev, {
    req(all_urls)
    idx <- max(1L, current_idx() - 1L)
    current_idx(idx)
    push_image(idx)
  })
  
  # ── Tile selection from events.js (1-based row/col) ───────────────────────
  observeEvent(input$selected_tiles, {
    tiles <- input$selected_tiles
    if (is.null(tiles)) return()
    result <- if (is.data.frame(tiles)) {
      lapply(seq_len(nrow(tiles)), function(i)
        list(row = tiles$row[i], col = tiles$col[i]))
    } else tiles
    sel_tiles(result)
    
    # ── Persistence hook ───────────────────────────────────────────────────
    # df <- data.frame(
    #   timestamp  = Sys.time(),
    #   image_name = basename(all_urls[[current_idx()]]),
    #   row        = sapply(result, `[[`, "row"),
    #   col        = sapply(result, `[[`, "col")
    # )
    # mongolite::mongo("tiles", url = Sys.getenv("MONGO_URL"))$insert(df)
  })
}

shinyApp(ui, server)