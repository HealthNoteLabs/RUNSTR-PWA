# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

RUNSTR PWA is a browser-focused Progressive Web App for Nostr-powered running. Built with React + Vite, it runs exclusively in web browsers and features GPS tracking, bitcoin wallet integration, team challenges, and music streaming via Wavlake. This is the web-optimized version of RUNSTR designed for browser deployment and usage.

## Essential Commands

### Development
```bash
npm run dev                 # Start Vite dev server with HMR (browser-only)
npm run build              # Production build for web deployment
npm run preview            # Preview production build locally
```

### Code Quality
```bash
npm run lint               # ESLint with React plugins
npm run format             # Prettier formatting
npm run format:check       # Check formatting without changes
```

### Testing
```bash
npm run test               # Run Vitest test suite
npm run test:watch         # Watch mode testing
npm run test:coverage      # Generate coverage report
npm run test:manual        # Manual testing with dedicated config
```

### Debugging & Scripts
```bash
npm run debug              # Run nostr-debug.cjs for protocol debugging
npm run diagnose-feed      # Debug feed issues
npm run rewards:fetch      # Fetch weekly workout data
node scripts/dev.js list   # Meta-development task management
```

## Architecture

### Technology Stack
- **Frontend**: React 18.3.1 + TypeScript + Vite 5.4.10
- **Platform**: Progressive Web App (PWA) - Browser-only deployment
- **Styling**: Tailwind CSS 3.4.17 + Framer Motion
- **Nostr**: NDK 2.12.2 + nostr-tools 2.12.0
- **GPS**: Browser Geolocation API with Kalman filtering
- **Wallet**: @getalby/bitcoin-connect + NWC integration

### Key Services
- **RunTracker.js**: Advanced GPS tracking with sensor fusion and gap filling
- **ndkSingleton.ts**: Global NDK instance for Nostr connectivity
- **NostrContext.jsx**: Auth and signer management (Amber/NIP-07/private key)
- **RunDataService.js**: Local storage and Nostr event publishing
- **TeamsDataService.js**: NIP-29 group management and team functionality

### Code Organization
```
src/
├── components/           # UI components (React + TypeScript)
├── contexts/            # React Context providers
├── hooks/               # Custom React hooks for business logic
├── services/            # Core business logic and API services
├── utils/               # Utility functions and algorithms
├── pages/               # Route components
└── lib/                 # Shared libraries (NDK singleton, utils)
```

### Data Architecture
- **Local Storage**: Run data, user preferences, cached profiles
- **Nostr Events**: Run publishing (kind 1063), team management (NIP-29)
- **Real-time**: EventEmitter pattern for GPS updates and UI reactivity
- **Offline**: Service worker with background sync capabilities

## Development Patterns

### GPS Tracking
The app uses sophisticated GPS filtering:
- **Kalman filtering** (`utils/kalmanFilter.js`) for accuracy improvement
- **Sensor fusion** (`utils/sensorFusion.js`) with device motion API
- **Gap filling** (`utils/trajectoryPrediction.js`) for GPS outages
- **Adaptive sampling** based on speed, battery, and movement patterns

### Nostr Integration
- **NDK Singleton**: Single global instance in `lib/ndkSingleton.ts`
- **Multiple Signers**: Amber (Android), NIP-07 (web), private key fallback
- **Event Publishing**: Run data as kind 1063 events with location metadata
- **Teams**: NIP-29 groups for challenges and leaderboards

### State Management
- **React Context**: For auth, settings, teams, achievements
- **Service Classes**: For complex business logic (RunTracker, RunDataService)
- **Local Storage**: Persistent data with JSON serialization
- **Event Emitters**: For real-time updates (GPS, audio player)

### Browser Considerations
- **PWA Features**: Service worker for offline functionality and caching
- **GPS Tracking**: Browser Geolocation API with permission handling
- **Local Storage**: IndexedDB and localStorage for data persistence
- **Cross-Browser**: Optimized for Chrome, Firefox, Safari, Edge

## Testing

### Test Structure
- **Unit Tests**: Vitest with jsdom environment
- **Component Tests**: React Testing Library integration
- **Service Tests**: GPS calculations, Nostr event handling
- **Manual Testing**: Dedicated Vite config for browser testing

### Key Test Files
- `RunTracker.test.js`: GPS tracking and calculations
- `NostrIntegration.test.js`: Event publishing and relay connectivity
- `leaderboardUtils.test.ts`: Ranking and statistics calculations
- `streakUtils.test.ts`: Achievement and streak logic

## Build & Deployment

### Production Build
- **Vite**: Optimized bundling with manual chunks (vendor, audioPlayer)
- **Terser**: Minification with console.log removal
- **Source Maps**: Disabled for production security
- **CSS**: Code splitting enabled for better caching

### Web Deployment
1. Build for production: `npm run build`
2. Deploy `dist/` folder to web server (Netlify, Vercel, etc.)
3. Configure HTTPS for GPS access and service worker functionality
4. Set up proper headers for PWA manifest and service worker

### Environment Configuration
- **Vite Config**: `vite.config.js` for build settings and proxies
- **Vite Proxy**: Wavlake API proxy for development CORS
- **ESLint**: React-specific rules with disabled overlay for cleaner development
- **PWA Manifest**: `public/manifest.json` for app installation

## Key Features

### Advanced GPS Tracking
- Kalman filtering for 20-40% accuracy improvement
- Multiple filtering modes (kalman, weighted averaging)
- Urban optimization and jump detection
- Battery-aware adaptive sampling

### Nostr Integration
- Multi-signer support (Amber, browser extension, private key)
- Real-time feed updates and profile caching
- Team management with NIP-29 groups
- Run data publishing with rich metadata

### Bitcoin Integration
- NWC wallet connectivity for lightning payments
- Ecash (Cashu) wallet for micropayments
- Season pass purchases and reward distributions
- Bitcoin Connect for wallet management

### Music Integration
- Wavlake API integration for streaming
- Background audio with notification controls
- Playlist management and track caching
- Audio player state synchronization

## Common Tasks

### Adding New Components
1. Use TypeScript for new components (.tsx)
2. Follow existing component patterns in `components/`
3. Use Tailwind classes with design system tokens
4. Implement proper error boundaries for critical components

### GPS Feature Development
1. GPS calculations go in `utils/runCalculations.js`
2. Filtering algorithms in `utils/kalmanFilter.js`
3. Test accuracy improvements with actual device testing
4. Consider battery impact of new tracking features

### Nostr Event Handling
1. Use NDK singleton for all Nostr operations
2. Handle connection failures gracefully
3. Cache events locally for offline functionality
4. Follow Nostr event standards (NIPs)

### Browser Development
1. Test GPS accuracy across different browsers and devices
2. Handle browser geolocation permissions properly
3. Implement service worker for background functionality
4. Consider battery impact of continuous GPS tracking

## Scripts & Utilities

### Meta-Development
The `scripts/dev.js` provides task management:
- `node scripts/dev.js list`: View all development tasks
- `node scripts/dev.js expand --id=X`: Break down complex tasks
- `node scripts/dev.js next`: Find next task to work on

### Debug Scripts
- `npm run debug`: Debug Nostr connectivity issues
- `npm run diagnose-feed`: Troubleshoot feed problems
- Run individual scripts in `scripts/` for specific debugging

### Rewards & Analytics
- `npm run rewards:fetch`: Fetch workout data for analysis
- Various scripts for leaderboard debugging and reward calculations
- Use browser dev tools for GPS tracking analysis

## Performance Considerations

### Bundle Size
- Vendor chunk separation for better caching
- Audio player in separate chunk to reduce main bundle
- Tree shaking enabled for unused code elimination

### Runtime Performance
- GPS filtering to reduce battery drain
- Event debouncing for UI updates
- Profile caching to reduce network requests
- Lazy loading for route-based code splitting

### Memory Management
- Proper cleanup of GPS listeners and intervals
- Audio player state management
- NDK connection lifecycle management
- Component unmounting cleanup

## Security & Privacy

### Key Management
- Secure storage of Nostr private keys
- NIP-07 support for browser extension signers
- Amber integration for Android-native signing

### Data Privacy
- Local-first data storage
- Minimal external API dependencies
- User-controlled data sharing
- GPS data encryption for sensitive routes

### Network Security
- HTTPS for all external communications
- Relay connection validation
- Input sanitization for Nostr events
- XSS protection in content rendering

## Browser Compatibility & Fixes

### Critical Browser Loading Issue (Fixed 2025-08-04)
**Problem:** App was stuck on loading spinner in browser due to Node.js compatibility issues.

**Root Cause:** Dependency chain `MenuBar.jsx → rewardsPayoutService → nwcService.js` caused uncaught `ReferenceError: process is not defined` during module loading, preventing React from mounting.

**Solution Applied:**
1. **Removed unused import** - `rewardsPayoutService` from MenuBar.jsx (line 8)
2. **Fixed process.env references** - Added browser-safe checks in nwcService.js and RunClub.jsx
3. **Enhanced error handling** - Added graceful degradation for Node.js globals
4. **Maintained functionality** - Payment services still work via lazy loading when needed

**Files Modified:**
- `src/components/MenuBar.jsx` - Removed unused import
- `src/services/nwcService.js` - Added `typeof process !== 'undefined'` checks
- `src/pages/RunClub.jsx` - Used `import.meta.env.DEV` for development detection
- `src/App.jsx` - Enhanced error handling for browser compatibility

**Prevention:** Always check for Node.js globals before using them. Use Vite's `import.meta.env` for environment detection in browser contexts.