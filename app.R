library(shiny)
library(jsonlite)
library(tools)

# ── UI ────────────────────────────────────────────────────────────────────────
ui <- fluidPage(

  # External CSS and JS (served from www/)
  tags$head(
    tags$link(rel = "stylesheet", href = "styles.css"),
    tags$script(src = "grid.js")
  ),

  h1("DuoWeeDo"),
  div(class = "subtitle", "CLick the weed tiles"),

  div(class = "main-layout",

    # ── Canvas zone ──────────────────────────────────────────────────────────
    div(class = "canvas-wrapper",
      tags$img(id = "base-image", src = NULL, alt = ""),
      tags$canvas(id = "grid-canvas")
    ),

    # ── Side panel ───────────────────────────────────────────────────────────
    div(class = "side-panel",

      div(class = "panel-card",
        div(class = "panel-label", "Controls"),
        div(class = "btn-row",
          actionButton("new_image", "\u21bb New Image", class = "btn-shiny"),
          actionButton("clear_sel", "\u2715 Clear",     class = "btn-shiny danger")
        ),
        br(),
        div(class = "panel-label", "Grid size"),
        sliderInput("grid_size", label = NULL,
          min = 2, max = 16, value = 8, step = 1, ticks = FALSE),
        div(class = "panel-label", "Perspective"),
        sliderInput("perspective", label = NULL,
          min = 0, max = 45, value = 22, step = 1, ticks = FALSE)
      ),

      div(class = "panel-card",
        div(class = "panel-label",
          "Selected Tiles",
          tags$span(id = "sel-count", class = "count-chip", "0")
        ),
        div(id = "tile-list",
          div(class = "empty-state", "No tiles selected yet")
        )
      ),

      div(class = "panel-card",
        div(class = "panel-label", "Export"),
        div(class = "btn-row",
          downloadButton("dl_csv", "CSV", class = "btn-shiny accent"),
          downloadButton("dl_txt", "TXT", class = "btn-shiny accent")
        )
      )
    )
  )
)

# ── Server ────────────────────────────────────────────────────────────────────
server <- function(input, output, session) {

  img_dir   <- "images"
  img_ext   <- c("jpg", "jpeg", "png", "gif", "bmp", "webp")
  sel_tiles <- reactiveVal(list())

  # ── Helper: pick a random image and copy it to www/ for serving ────────────
  load_random_image <- function() {
    if (!dir.exists(img_dir)) {
      showNotification("\u26a0 'images/' folder not found.", type = "error")
      return(NULL)
    }
    files <- list.files(img_dir, full.names = TRUE)
    files <- files[file_ext(files) %in% img_ext]
    if (length(files) == 0) {
      showNotification("\u26a0 No images found in images/ folder.", type = "error")
      return(NULL)
    }
    chosen  <- sample(files, 1)
    www_dir <- file.path("www", "current_image")
    dir.create(www_dir, showWarnings = FALSE, recursive = TRUE)
    dest    <- file.path(www_dir, basename(chosen))
    file.copy(chosen, dest, overwrite = TRUE)
    paste0("current_image/", basename(chosen))
  }

  # ── On startup: load first image ───────────────────────────────────────────
  observe({
    src <- load_random_image()
    if (!is.null(src)) {
      session$sendCustomMessage("load_image", list(
        src         = src,
        grid        = isolate(input$grid_size)   %||% 8,
        perspective = isolate(input$perspective) %||% 22
      ))
    }
  })

  # ── New image button ───────────────────────────────────────────────────────
  observeEvent(input$new_image, {
    sel_tiles(list())
    src <- load_random_image()
    if (!is.null(src)) {
      session$sendCustomMessage("load_image", list(
        src         = src,
        grid        = input$grid_size,
        perspective = input$perspective
      ))
    }
  })

  # ── Grid size or perspective change → redraw ───────────────────────────────
  observeEvent(list(input$grid_size, input$perspective), {
    session$sendCustomMessage("redraw_grid", list(
      grid        = input$grid_size,
      perspective = input$perspective
    ))
  }, ignoreInit = TRUE)

  # ── Clear selection ────────────────────────────────────────────────────────
  observeEvent(input$clear_sel, {
    sel_tiles(list())
    session$sendCustomMessage("clear_tiles", list())
  })

  # ── Sync JS selection to R ─────────────────────────────────────────────────
  observeEvent(input$selected_tiles, {
    parsed <- tryCatch(
      fromJSON(input$selected_tiles),
      error = function(e) list()
    )
    sel_tiles(parsed)
  })

  # ── Helper: build a clean data.frame from selection ────────────────────────
  make_df <- function() {
    tiles <- sel_tiles()
    if (length(tiles) == 0 ||
        (is.data.frame(tiles) && nrow(tiles) == 0))
      return(data.frame(row = integer(), col = integer()))

    if (is.data.frame(tiles)) {
      data.frame(row = tiles$row + 1L, col = tiles$col + 1L)
    } else {
      data.frame(
        row = sapply(tiles, `[[`, "row") + 1L,
        col = sapply(tiles, `[[`, "col") + 1L
      )
    }
  }

  # ── Downloads ──────────────────────────────────────────────────────────────
  output$dl_csv <- downloadHandler(
    filename = function() paste0("tiles_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".csv"),
    content  = function(file) write.csv(make_df(), file, row.names = FALSE)
  )

  output$dl_txt <- downloadHandler(
    filename = function() paste0("tiles_", format(Sys.time(), "%Y%m%d_%H%M%S"), ".txt"),
    content  = function(file) {
      df    <- make_df()
      lines <- if (nrow(df) == 0) "No tiles selected." else
                 apply(df, 1, function(r) paste0("[", r["row"], ",", r["col"], "]"))
      writeLines(lines, file)
    }
  )
}

# ── Null-coalescing operator ───────────────────────────────────────────────────
`%||%` <- function(a, b) if (!is.null(a)) a else b

shinyApp(ui, server)
