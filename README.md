# @himetrica/tracker-react-native

A lightweight, privacy-focused analytics and error tracking SDK for React Native applications.

## Features

- **Screen tracking** - Automatic screen view tracking with React Navigation integration
- **Custom events** - Track user actions with custom properties
- **User identification** - Associate analytics with user profiles
- **Error tracking** - Capture errors, unhandled rejections, and React component crashes
- **Session management** - Automatic session handling with configurable timeout
- **Offline support** - Events queued and sent when connectivity is restored
- **Duration tracking** - Automatic time-on-screen measurement
- **App lifecycle** - Handles background/foreground transitions gracefully
- **Dual format** - Ships ESM and CJS with full TypeScript declarations
- **React integration** - Provider, ErrorBoundary, and hooks included

## Requirements

- React Native >= 0.70
- React >= 18
- `@react-native-async-storage/async-storage` >= 1.17.0
- (Optional) `@react-navigation/native` >= 6.0 for automatic navigation tracking

## Installation

```bash
npm install @himetrica/tracker-react-native @react-native-async-storage/async-storage
```

```bash
yarn add @himetrica/tracker-react-native @react-native-async-storage/async-storage
```

```bash
pnpm add @himetrica/tracker-react-native @react-native-async-storage/async-storage
```

## Quick Start

### React (Recommended)

Wrap your app with `HimetricaProvider`:

```tsx
import { HimetricaProvider, HimetricaErrorBoundary } from "@himetrica/tracker-react-native/react";

function App() {
  return (
    <HimetricaProvider apiKey="your-api-key">
      <HimetricaErrorBoundary fallback={<ErrorScreen />}>
        <MainApp />
      </HimetricaErrorBoundary>
    </HimetricaProvider>
  );
}
```

### With React Navigation

```tsx
import { NavigationContainer } from "@react-navigation/native";
import { HimetricaProvider, useHimetricaNavigation } from "@himetrica/tracker-react-native/react";

function AppNavigator() {
  const { ref, onReady, onStateChange } = useHimetricaNavigation();

  return (
    <NavigationContainer ref={ref} onReady={onReady} onStateChange={onStateChange}>
      {/* Your screens */}
    </NavigationContainer>
  );
}

function App() {
  return (
    <HimetricaProvider apiKey="your-api-key">
      <AppNavigator />
    </HimetricaProvider>
  );
}
```

### Vanilla (without React hooks)

```typescript
import { HimetricaClient } from "@himetrica/tracker-react-native";

const hm = new HimetricaClient({
  apiKey: "your-api-key",
});

await hm.init();

// Track a screen view
hm.trackScreen("Home");

// Track a custom event
hm.track("purchase_completed", { plan: "pro" });

// Identify a user
await hm.identify({
  name: "Jane Doe",
  email: "jane@example.com",
  metadata: { plan: "pro" },
});

// Clean up when done
await hm.destroy();
```

## Hooks

```tsx
import {
  useHimetrica,
  useTrackEvent,
  useCaptureError,
  useTrackScreen,
} from "@himetrica/tracker-react-native/react";

function CheckoutButton() {
  const trackEvent = useTrackEvent();

  return (
    <Pressable onPress={() => trackEvent("checkout_started", { items: 3 })}>
      <Text>Checkout</Text>
    </Pressable>
  );
}

function DataLoader() {
  const captureError = useCaptureError();

  useEffect(() => {
    fetchData().catch((err) => {
      captureError(err, { component: "DataLoader" });
    });
  }, []);

  return <View>...</View>;
}

function ProfileScreen() {
  // Manually track a screen (useful without React Navigation)
  useTrackScreen("Profile");

  return <View>...</View>;
}

function AdvancedUsage() {
  const hm = useHimetrica(); // Full client access

  hm.identify({ name: "Jane", email: "jane@example.com" });
  hm.track("page_interaction", { section: "hero" });
}
```

## Error Tracking

Errors are captured automatically by default (uncaught exceptions and unhandled promise rejections). You can also capture errors manually:

```tsx
import { useCaptureError } from "@himetrica/tracker-react-native/react";

function RiskyComponent() {
  const captureError = useCaptureError();

  const handleSync = async () => {
    try {
      await riskyOperation();
    } catch (error) {
      captureError(error as Error, { operation: "data_sync" });
    }
  };

  return <Button title="Sync" onPress={handleSync} />;
}
```

### Capture a message

```typescript
hm.captureMessage("Rate limit exceeded", "warning", { userId: "123" });
```

### Error Boundary

Wrap components to automatically capture React render errors:

```tsx
import { HimetricaErrorBoundary } from "@himetrica/tracker-react-native/react";

<HimetricaErrorBoundary fallback={<ErrorScreen />}>
  <MyScreen />
</HimetricaErrorBoundary>
```

Errors are rate-limited (max 10/minute) and deduplicated (5-minute window) to avoid flooding.

## Configuration

```typescript
const hm = new HimetricaClient({
  apiKey: "your-api-key",           // Required
  apiUrl: "https://app.himetrica.com", // Custom API endpoint (self-hosting)
  autoTrackScreens: true,           // Auto-track screen views
  autoTrackErrors: true,            // Auto-capture uncaught errors and rejections
  sessionTimeout: 30 * 60 * 1000,  // Session timeout in ms (default: 30 min)
  enableLogging: false,             // Print [Himetrica] debug logs
  maxQueueSize: 1000,              // Max offline queue size
  flushInterval: 30,               // Queue flush interval (seconds)
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Your Himetrica API key |
| `apiUrl` | `string` | `"https://app.himetrica.com"` | Custom API endpoint |
| `autoTrackScreens` | `boolean` | `true` | Auto-track screen views |
| `autoTrackErrors` | `boolean` | `true` | Auto-capture errors and rejections |
| `sessionTimeout` | `number` | `1800000` (30 min) | Session timeout in ms |
| `enableLogging` | `boolean` | `false` | Enable debug logging |
| `maxQueueSize` | `number` | `1000` | Max queued events |
| `flushInterval` | `number` | `30` | Queue flush interval (seconds) |

## API Reference

### HimetricaClient

| Method | Description |
|--------|-------------|
| `init()` | Initialize the client (called automatically by Provider) |
| `trackScreen(name, path?)` | Track a screen view |
| `track(eventName, properties?)` | Track a custom event |
| `identify({ name?, email?, metadata? })` | Identify the current user |
| `captureError(error, context?)` | Capture an error |
| `captureMessage(message, severity?, context?)` | Capture a message |
| `getVisitorId()` | Get the current visitor ID |
| `flush()` | Force flush the event queue |
| `destroy()` | Clean up and flush pending events |

### React Exports (`@himetrica/tracker-react-native/react`)

| Export | Description |
|--------|-------------|
| `HimetricaProvider` | Context provider, accepts all config props |
| `HimetricaErrorBoundary` | Error boundary that reports to Himetrica |
| `useHimetrica()` | Access the client instance |
| `useTrackEvent()` | Returns a `track()` function |
| `useCaptureError()` | Returns a `captureError()` function |
| `useTrackScreen(name, path?)` | Track a screen on mount |
| `useHimetricaNavigation()` | React Navigation integration |

## Features

### Automatic Screen Tracking

When using `useHimetricaNavigation()` with React Navigation, the SDK automatically tracks:
- Every screen transition (resolved from nested navigators)
- Screen duration (sent on navigation and background transitions)
- Deduplication of consecutive same-screen events

### Offline Support

Events are automatically queued when they fail to send:
- Events are persisted to AsyncStorage and survive app restarts
- Queue is flushed in batches of 50 when connectivity returns
- Failed events are retried up to 3 times
- Queue is pruned to `maxQueueSize` to prevent unbounded growth
- Queue is automatically saved when the app goes to background

### Session Management

Sessions expire after 30 minutes of inactivity (configurable). A new session is created when:
- The app is launched for the first time
- The session timeout has elapsed since the last activity
- Sessions are refreshed when the app returns from background

### App Lifecycle Handling

The SDK responds to app state changes:
- **Background**: Sends pending screen duration and persists the offline queue
- **Foreground**: Refreshes the session and flushes queued events

## Data Stored

The SDK uses AsyncStorage to persist:

| Key | Description |
|-----|-------------|
| `hm_visitor_id` | Persistent anonymous visitor UUID |
| `hm_session_id` | Current session UUID |
| `hm_session_timestamp` | Last activity timestamp |
| `hm_offline_queue` | Pending events for retry |

## Troubleshooting

### Events not being sent

1. Enable logging: `enableLogging: true`
2. Check the console for `[Himetrica]` messages
3. Verify your API key is correct
4. Check network connectivity

### Session not persisting

Sessions are stored in AsyncStorage. If sessions reset unexpectedly:
1. Ensure `sessionTimeout` is set appropriately
2. Check that AsyncStorage isn't being cleared by another library

### Navigation tracking not working

1. Ensure `useHimetricaNavigation()` is used inside `HimetricaProvider`
2. Pass all three props (`ref`, `onReady`, `onStateChange`) to `NavigationContainer`
3. Check that `@react-navigation/native` is installed

## License

MIT License
