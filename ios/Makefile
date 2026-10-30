# The iPhone app. `make install` builds it and puts it on a plugged-in (or paired) iPhone.
PROJECT = BasementReady.xcodeproj
SCHEME = BasementReady
DERIVED = build
SIM ?= iPhone 17
APP_DEVICE = $(DERIVED)/Build/Products/Debug-iphoneos/BasementReady.app
APP_SIM = $(DERIVED)/Build/Products/Debug-iphonesimulator/BasementReady.app

.PHONY: generate build-sim build-device test test-unit test-ui install run-sim replay clean

$(PROJECT): project.yml
	xcodegen generate --quiet

generate:
	xcodegen generate --quiet

build-sim: $(PROJECT)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath $(DERIVED) build -quiet

build-device: $(PROJECT)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath $(DERIVED) -allowProvisioningUpdates build -quiet

# Unit tests and the UI test (start → film a replayed take → send → result), with the free local
# test server (scripts/test-server.sh) started for it if it isn't running.
test: $(PROJECT)
	TEST_RUNNER_BR_SERVER=http://localhost:5183 sh scripts/with-test-server.sh xcodebuild -project $(PROJECT) -scheme $(SCHEME) -destination 'platform=iOS Simulator,name=$(SIM)' -derivedDataPath $(DERIVED) test -quiet

test-unit: $(PROJECT)
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) -destination 'platform=iOS Simulator,name=$(SIM)' -derivedDataPath $(DERIVED) test -only-testing:BasementReadyTests -quiet

test-ui: $(PROJECT)
	TEST_RUNNER_BR_SERVER=http://localhost:5183 sh scripts/with-test-server.sh xcodebuild -project $(PROJECT) -scheme $(SCHEME) -destination 'platform=iOS Simulator,name=$(SIM)' -derivedDataPath $(DERIVED) test -only-testing:BasementReadyUITests -resultBundlePath $(DERIVED)/ui-$$(date +%H%M%S).xcresult -quiet

# The first phone listed by `xcrun devicectl list devices`, or DEVICE=<name or id>.
install: build-device
	xcrun devicectl device install app --device "$${DEVICE:-$$(xcrun devicectl list devices --hide-default-columns --hide-headers --columns Identifier --filter "Platform == 'iOS' AND Reality == 'physical'" 2>/dev/null | awk 'NF { print $$1; exit }')}" $(APP_DEVICE)

run-sim: build-sim
	xcrun simctl boot "$(SIM)" 2>/dev/null || true
	xcrun simctl install "$(SIM)" $(APP_SIM)
	xcrun simctl launch "$(SIM)" com.davidbarry.basementready

# Plays a recorded take in the simulator as if it were ARKit: make replay TAKE=<folder> [SPEED=2]
replay: build-sim
	sh scripts/replay.sh "$${TAKE:-Fixtures/b2-finished-family}" $${SPEED:-1}

clean:
	rm -rf $(DERIVED) $(PROJECT)
