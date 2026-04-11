# Feature Specification: Custom Model Storage Path

**Feature Branch**: `001-custom-model-path`  
**Created**: 2026-04-10
**Status**: Draft  
**Input**: User description: "my friend Matthew installed this app on Windows... stuck with message Preparing the model... replace the standard path to store models with a folder of user choice..."

## Clarifications

### Session 2026-04-10

- Q: Can the user proactively change this directory path later? → A: Yes, add an option in the Settings tab to let users change the path at any time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select Custom Directory on Download (Priority: P1)

As a user setting up the application or downloading an AI model, I want to choose the download directory so that I can store models on a drive of my choice and avoid permission or system-specific silent failure issues.

**Why this priority**: Core workaround/fix for the silent failure experienced on certain desktop operating systems.

**Independent Test**: Can be fully tested by clicking to download a model and verifying a directory selection dialog appears and the download proceeds and completes in that chosen directory.

**Acceptance Scenarios**:

1. **Given** the user is on the model download screen and has not yet set a model path, **When** they initiate the download, **Then** they are presented with a native directory selection dialog.
2. **Given** the user selects a valid directory, **When** they confirm the selection, **Then** the model downloads to that location and the system proceeds successfully.

---

### User Story 2 - Persistent Model Path Storage (Priority: P2)

As a user who has previously downloaded a model, I want the application to remember my selected storage location so that I do not need to reselect it upon restarting the application.

**Why this priority**: Essential for a seamless user experience across sessions.

**Independent Test**: Can be tested by restarting the application and verifying that the previously chosen model runs correctly from the custom location without prompting again.

**Acceptance Scenarios**:

1. **Given** the application is restarted, **When** it initializes the AI model, **Then** it uses the previously saved custom path instead of a default path.

---

### Edge Cases

- What happens when the custom directory becomes unavailable (e.g., an external drive is disconnected)? 
- What happens when the user cancels the directory selection dialog during the download prompt?
- How does the application handle users migrating from an older installation that already has models cached in the standard location? Answer: No automatic migration is needed. The application will prompt for the directory if the setting isn't set, and users will manually delete the old default folders if desired.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present a native directory selection dialog when the user attempts to download an AI model and a custom path has not yet been set.
- **FR-002**: The system MUST store the user-selected model directory path persistently across application restarts.
- **FR-003**: The system MUST use the persisted custom directory path as the target for caching and model loading.
- **FR-004**: The system MUST handle cancellation of the directory selection dialog gracefully, halting the download process without leaving the application in an unusable state.
- **FR-005**: The system MUST attempt a fallback or prompt for a new directory if the previously saved directory is no longer accessible or writable.
- **FR-006**: The system MUST provide an interface in the Settings tab allowing users to view and change their custom model directory path at any time.

### Key Entities

- **Application Settings**: Extended to include a persistent path reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users on Windows can successfully download and initialize an AI model without experiencing the silent failure/hang.
- **SC-002**: 100% of newly downloaded models are stored in the user-specified directory instead of the hardcoded default path.
- **SC-003**: Users are not prompted for the directory path more than once unless the path becomes invalid or they explicitly choose to change it.

## Assumptions

- The underlying framework provides native dialog functionality to show a directory picker.
- The underlying AI engine supports overriding its default caching directory.
- The custom directory path will be stored as a global application setting, rather than specific to a single document library.
