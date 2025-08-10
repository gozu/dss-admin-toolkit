# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Dataiku plugin called "Diag Parser" - a browser-based diagnostic file analyzer that runs entirely client-side. It's designed to parse and visualize Dataiku diagnostic ZIP files, displaying system configurations, resource usage, memory allocation, connections, and potential issues without sending data to any server.

## Architecture

The application is structured as a single-page web application with all code in body.html. none of the other files are used.
### Core Classes (in body.html:800-4900)

**Parser Classes** - Handle specific file types and data extraction:
- `BaseJSONParser` - Base class for parsing JSON configuration files
- `BaseTextParser` - Base class for parsing text-based log and system files  
- `VersionParser` - Extracts DSS version information
- `UsersParser` - Parses user accounts and permissions
- `ConnectionsParser` - Analyzes database/API connections
- `LicenseParser` - Processes licensing information
- `GeneralSettingsParser` - Handles DSS configuration settings
- `LogParser` - Parses DSS log files with syntax highlighting
- `JavaMemoryParser` - Analyzes JVM memory usage from logs
- `RestartTimeParser` - Determines last DSS restart time
- `SystemInfoParser` - Processes system information
- `MemoryInfoParser` - Parses memory usage data
- `ProjectsParser` - Handles project configurations
- `CodeEnvsParser` - Manages code environment information
- `PluginDiscoveryParser` - Discovers installed plugins from file paths
- `VersionExtractionParser` - Extracts Python and Spark versions from diag.txt

**UI Renderer Classes** - Handle data visualization and display:
- `UIRenderer` - Main UI coordination and layout management
- `FileViewer` - Handles file content display with syntax highlighting
- `TableRenderer` - Generic table rendering functionality
- `ProjectsTableRenderer` - Specialized project data tables
- `MemoryChartRenderer` - Memory usage visualizations
- `ConnectionsChartRenderer` - Connection topology charts
- `FilesystemTableRenderer` - File system data display

**Processing Classes** - Core application logic:
- `FileExtractor` - Handles ZIP file extraction and decompression
- `FileProcessor` - Coordinates file upload and processing workflow
- `FileManager` - Handles file lookup, path resolution, and DSSHOME detection
- `UIStateManager` - Manages table filtering, searching, and UI state
- `ErrorDisplayHandler` - Handles error display and user messaging
- `AppLifecycleManager` - Manages application initialization and reset functionality
- `DSSParser` - Main orchestrator that coordinates all parsing operations

### Key Features

- **Client-side Processing**: All ZIP extraction and parsing happens in the browser
- **Syntax Highlighting**: Custom log4j language definition for DSS logs
- **Interactive Visualizations**: Charts for memory usage, connections, and system metrics
- **File Browsing**: Built-in file viewer for exploring diagnostic contents
- **Search Functionality**: Filter and search through parsed data
- **Export Capabilities**: Download processed files and reports

### File Structure

```
diag-parser/
├── plugin.json           # Plugin metadata and configuration
└── webapps/parser/
    ├── webapp.json        # Web app configuration
    ├── app.js             # Minimal initialization (defers to body.html)
    ├── body.html          # Main application (contains all logic and classes)
    └── style.css          # Minimal styling (most styles inline in body.html)
```

## Development Commands

This is a frontend-only application with no build process. Development is done by directly editing the HTML/CSS/JavaScript files.

**Testing**: Open `body.html` directly in a browser then open a diag zip file, process it and see the results.

## Code Organization Principles

- **Single File Architecture**: All application logic resides in `body.html` for simplified deployment
- **Class-based Design**: Functionality is organized into specialized classes with clear responsibilities  
- **Parser Pattern**: Consistent base classes (`BaseJSONParser`, `BaseTextParser`) for different file types
- **Client-side Only**: No server dependencies - all processing happens in the browser
- **Modular Rendering**: Separate classes handle different aspects of UI rendering and data visualization

## Key Dependencies

- `zip.js` - ZIP file extraction
- `pako` - GZIP decompression  
- `highlight.js` - Syntax highlighting with custom log4j language definition

## Working with the Code

- The only application logic is in `body.html` starting around line 800
- Parser classes follow a consistent pattern - extend base classes and implement `parse()` method
- UI renderers typically have `render()` methods that return HTML strings or DOM elements
- All file processing is asynchronous and uses modern JavaScript features
- Custom CSS classes and styling are embedded inline within the HTML
- Specialized classes are instantiated in DSSParser constructor and accessed directly
- Recent refactoring has extracted file management, UI state, error handling, and lifecycle management into focused classes
- Renderer classes are called directly (e.g., `this.parser.tableRenderer.createTable()`) rather than through wrapper methods