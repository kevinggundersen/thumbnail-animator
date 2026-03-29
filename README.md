# Thumbnail Animator


A desktop application built with Electron for browsing and viewing media files (videos and images) with an intuitive thumbnail-based interface.


![Banner2](https://github.com/user-attachments/assets/305da94e-4341-4937-bee0-ddf9701412f3)

## Features

### Browsing & Navigation
- **Media Browser**: Browse folders and view thumbnails of videos and images
- **Folder Sidebar**: Tree-based folder navigation panel
- **Tab System**: Open multiple folders in separate tabs
- **Favorites**: Save and manage favorite folders for quick access
- **Recent Files**: Dropdown for recently accessed files
- **Back/Forward Navigation**: Easy folder history navigation
- **Breadcrumb Navigation**: See and click through your current folder path

### Filtering & Search
- **File Filtering**: Filter by type (All, Videos, Images, Audio)
- **Quick Search**: Filter files by name in real time
- **Advanced Search**: Filter by file size, date range, dimensions, aspect ratio, and star ratings

### Viewing & Playback
- **Lightbox Viewer**: Click any media file to view it in fullscreen
- **Video Controls**: Playback speed (1x, 1.5x, 2x, etc.), loop and repeat modes
- **Scrubber Preview**: Hover over the video timeline to preview frames
- **Auto-Repeat**: Optionally loop videos automatically
- **Pause Behaviors**: Pause on lightbox open or window blur

### File Management
- **Context Menu**: Right-click files for options:
  - Open with default application
  - Open with (choose application)
  - Rename files
  - Reveal in Explorer
  - Delete files
- **Organize Files**: Create folders, move files, organize by date or file type
- **Copy Path/Name**: Quickly copy file paths or names from the lightbox

### Customization
- **Layout Modes**: Dynamic (Masonry) or Grid layout
- **Themes**: Light and Dark theme support
- **Zoom Control**: Adjust thumbnail zoom from 50% to 200%
- **Thumbnail Quality**: Low, Medium, or High quality settings
- **Settings Panel**: Remember last folder, include animated images in filters, sort options, and more

### Performance
- **Performance Dashboard**: Real-time monitoring (Ctrl+Shift+P)
- **3-Tier Caching**: Memory, IndexedDB, and disk caching for fast loading
- **Progressive Rendering**: Efficiently handles large folders (1000+ items)
- **File System Watching**: Real-time folder updates via chokidar
- **Window State Persistence**: Remembers window position and size

### Supported Formats
- **Videos**: `.mp4`, `.webm`, `.ogg`, `.mov`
- **Images**: `.gif`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.svg`

## Requirements

- **Node.js** (v14 or higher recommended)
- **npm** (comes with Node.js)
- **Windows** (currently configured for Windows x64 builds)

## Installation

### Option 1: Download Pre-built Release (Recommended)

1. Go to the [Releases](https://github.com/kevinggundersen/thumnail-animator/releases) page
2. Download the latest `Thumbnail Animator Setup X.X.X.exe` file
3. Run the installer and follow the setup wizard
4. Launch the application from your desktop or Start menu

### Option 2: Build from Source

1. **Clone the repository**:
   ```bash
   git clone https://github.com/kevinggundersen/thumnail-animator.git
   cd thumnail-animator
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Run the application**:
   ```bash
   npm start
   ```

## Building the Application

To create a distributable Windows installer:

```bash
npm run build:win
```

The installer will be created in the `dist` folder.

For development builds (without publishing):

```bash
npm run dist
```

## Usage

1. **Select a Folder**: Click the "Select Folder" button to choose a folder containing your media files
2. **Browse**: Click on folders to navigate, or use the back/forward buttons
3. **Filter**: Use the filter buttons (All, Videos, Images, Audio) to show only specific file types
4. **Search**: Type in the search box to filter files by name
5. **View Media**: Click on any video or image thumbnail to view it in the lightbox
6. **Manage Files**: Right-click on any file for context menu options (rename, delete, open, etc.)
7. **Settings**: Click the settings gear icon (⚙️) to access layout and sorting options

## Development

### Project Structure

```
thumnail-animator/
├── main.js          # Main Electron process (window management, IPC handlers)
├── renderer.js      # Renderer process (UI logic, media grid, lightbox, settings)
├── preload.js       # Preload script (secure IPC bridge)
├── index.html       # Main HTML file (layout, panels, dialogs)
├── styles.css       # Application styles (themes, components, animations)
├── icons.js         # SVG icon system (Lucide-style icons)
├── package.json     # Project configuration and dependencies
└── build/           # Build resources (icons, etc.)
```

### Scripts

- `npm start` - Run the application in development mode
- `npm run build` - Build the application
- `npm run build:win` - Build Windows installer
- `npm run dist` - Create distribution build without publishing
- `npm run release` - Build and publish to GitHub releases

## Technical Details

- **Framework**: Electron 39.2.3
- **Build Tool**: electron-builder 25.1.8
- **Architecture**: x64 Windows (NSIS installer)
- **Security**: Context isolation enabled, node integration disabled
- **Caching**: 3-tier caching strategy (memory → IndexedDB → disk)
- **File Watching**: Real-time folder updates via chokidar
- **Video Dimensions**: Optional ffprobe integration for fast header-based detection
- **Rendering**: Progressive rendering for large folders with batched updates

## License

ISC

## Author

Kevin Gundersen

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Issues

If you encounter any bugs or have feature requests, please open an issue on the [GitHub Issues](https://github.com/kevinggundersen/thumnail-animator/issues) page.

