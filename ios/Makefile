# The iPhone app. `make install` builds it and puts it on a plugged-in (or paired) iPhone.
PROJECT = BasementReady.xcodeproj
SCHEME = BasementReady
DERIVED = build
SIM ?= iPhone 17
APP_DEVICE = $(DERIVED)/Build/Products/Debug-iphoneos/BasementReady.app
APP_SIM = $(DERIVED)/Build/Products/Debug-iphonesimulator/BasementReady.app

.PHONY: generate build-sim build-device test install run-sim clean

$(PROJECT): project.yml
	xcodegen generate --quiet

generate:
	xcodegen generate --quiet

build-sim: $(PROJECT)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath $(DERIVED) build -quiet

build-device: $(PROJECT)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath $(DERIVED) -allowProvisioningUpdates build -quiet

test: $(PROJECT)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -destination 'platform=iOS Simulator,name=$(SIM)' -derivedDataPath $(DERIVED) test -quiet

# The first phone listed by `xcrun devicectl list devices`, or DEVICE=<name or id>.
install: build-device
	xcrun devicectl device install app --device "$${DEVICE:-$$(xcrun devicectl list devices --hide-default-columns --hide-headers --columns Identifier --filter "Platform == 'iOS' AND Reality == 'physical'" 2>/dev/null | awk 'NF { print $$1; exit }')}" $(APP_DEVICE)

run-sim: build-sim
	xcrun simctl boot "$(SIM)" 2>/dev/null || true
	xcrun simctl install "$(SIM)" $(APP_SIM)
	xcrun simctl launch "$(SIM)" com.davidbarry.basementready

clean:
	rm -rf $(DERIVED) $(PROJECT)
