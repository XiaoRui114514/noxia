import XCTest
import UIKit

/// Real React Native + Apple system speech + AVPlayer integration, on an iPad simulator.
/// This is not evidence of physical iPad, lock-screen, audio quality, or signing validation.
final class NoxiaUITests: XCTestCase {
  private enum ScenarioFailure: Error {
    case failed(String)
  }

  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  @MainActor
  func testOriginalTextSystemSpeechPlaybackAndBackgroundProgress() throws {
    XCTAssertEqual(UIDevice.current.userInterfaceIdiom, .pad, "Choose an iPad simulator destination, not an iPhone.")
    let app = XCUIApplication(bundleIdentifier: "com.noxia.app")
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    app.launch()
    defer {
      attach(app, name: "Final app state", note: app.state == .notRunning ? "Noxia is not running." : app.debugDescription)
      app.terminate()
    }

    let create = app.buttons["写一段文字"].firstMatch
    guard create.waitForExistence(timeout: 30) else {
      throw ScenarioFailure.failed("Home did not render the real create-text control within 30 seconds.")
    }
    create.tap()
    let title = app.textFields["作品标题"].firstMatch
    let body = app.textViews["输入或粘贴文字。可从 TXT / Markdown 导入。"].firstMatch
    guard title.waitForExistence(timeout: 10), body.waitForExistence(timeout: 10) else {
      throw ScenarioFailure.failed("Editor must expose its single-line title UITextField and multiline body UITextView.")
    }
    title.tap()
    title.typeText("Noxia Original Audio Test")
    body.tap()
    // Original test-only English prose, with enough duration to observe several transitions.
    // No imported lesson, user document, cloud request, microphone, or paid TTS is involved.
    body.typeText("A quiet morning begins beside an open window. I place a notebook on the table and choose one small idea to remember. First I listen carefully, then I leave enough time to think about the meaning in my own words. The room stays calm while the story continues. Outside, a bird crosses the garden and the light moves slowly across the floor. There is no reason to hurry. Learning can happen one clear sentence at a time. After a short rest I will return to the notebook and explain the idea again. This original passage is here to test continuous audio playback, a brief visit to the home screen, and a careful pause before listening again.")
    let save = app.buttons["保存文稿"].firstMatch
    guard save.waitForExistence(timeout: 10) else { throw ScenarioFailure.failed("Save manuscript control is missing.") }
    save.tap()
    let saved = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "已保存到本机。")).firstMatch
    guard saved.waitForExistence(timeout: 10) else { throw ScenarioFailure.failed("The original manuscript was not saved locally.") }
    attach(app, name: "Original manuscript saved")

    // The mini player sits below the editor, outside its ScrollView. Dismiss an
    // onscreen keyboard by an unhandled header tap before asking XCTest to tap it.
    if app.keyboards.firstMatch.exists {
      let heading = app.staticTexts["我的文稿"].lastMatch
      guard heading.exists, heading.isHittable else { throw ScenarioFailure.failed("Editor header is unavailable for keyboard dismissal.") }
      heading.tap()
      let hidden = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !app.keyboards.firstMatch.exists }, object: app)
      guard XCTWaiter.wait(for: [hidden], timeout: 5) == .completed else { throw ScenarioFailure.failed("The editor keyboard did not dismiss before mini-player playback.") }
    }

    // The editor has one transport button: the persistent mini player, not a mock test UI.
    let miniPlay = app.buttons["播放"].firstMatch
    guard miniPlay.waitForExistence(timeout: 10) else { throw ScenarioFailure.failed("Mini-player play control is missing.") }
    miniPlay.tap()
    try waitForNativePlayback(app)

    let progress = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "播放进度，点击定位")).firstMatch
    guard progress.waitForExistence(timeout: 10) else { throw ScenarioFailure.failed("Adjustable native playback progress is missing.") }
    let initial = try progressPercent(progress)
    try waitForProgress(progress, greaterThan: initial, timeout: 12)
    let foreground = try progressPercent(progress)
    attach(app, name: "System audio progresses in foreground", note: "Progress: \(initial)% -> \(foreground)%")

    let beforeHome = try progressPercent(progress)
    XCUIDevice.shared.press(.home)
    guard app.wait(for: .runningBackground, timeout: 5) else { throw ScenarioFailure.failed("The app did not enter background after pressing Home.") }
    // Deliberate bounded observation interval; no production JS timer or simulated clock.
    Thread.sleep(forTimeInterval: 3)
    app.activate()
    guard app.wait(for: .runningForeground, timeout: 10) else { throw ScenarioFailure.failed("The app did not reactivate.") }
    guard progress.waitForExistence(timeout: 5) else { throw ScenarioFailure.failed("Progress disappeared after reactivation.") }
    Thread.sleep(forTimeInterval: 0.5)
    let afterBackground = try progressPercent(progress)
    XCTAssertGreaterThan(afterBackground, beforeHome, "Native AVPlayer position must advance across a three-second Home-screen interval.")
    XCTAssertTrue(app.buttons["暂停"].firstMatch.exists, "Background playback must remain active after reactivation.")
    attach(app, name: "System audio progresses across Home screen", note: "Before Home: \(beforeHome)%; after reactivation: \(afterBackground)%.")

    app.buttons["暂停"].firstMatch.tap()
    guard app.buttons["播放"].firstMatch.waitForExistence(timeout: 5) else { throw ScenarioFailure.failed("Pause did not change the transport to Play.") }
    // Allow one pending status sample to arrive before checking the paused interval.
    Thread.sleep(forTimeInterval: 0.75)
    let paused = try progressPercent(progress)
    Thread.sleep(forTimeInterval: 3)
    XCTAssertEqual(try progressPercent(progress), paused, accuracy: 0.01, "Paused audio position must stay still.")
    attach(app, name: "Paused native audio stays still", note: "Paused progress: \(paused)%")

    app.buttons["播放"].firstMatch.tap()
    guard app.buttons["暂停"].firstMatch.waitForExistence(timeout: 5) else { throw ScenarioFailure.failed("Resume did not change the transport to Pause.") }
    try waitForProgress(progress, greaterThan: paused, timeout: 12)
    attach(app, name: "Resumed native audio progresses", note: "Resume: \(paused)% -> \(try progressPercent(progress))%")
    app.buttons["暂停"].firstMatch.tap()
  }

  @MainActor
  private func waitForNativePlayback(_ app: XCUIApplication) throws {
    // Only these explicit errors attest unavailable simulator voice assets.
    // Render timeout, missing module, malformed cache, crashes, and generic errors must fail.
    let missingVoiceMessages = [
      "请先在 iPad 设置中安装中文或英语系统声音。",
      "所选音色未安装，请重新选择系统声音。",
      "This system voice produced no audio. Download a voice in iPad Settings."
    ]
    func missingVoice() -> String? {
      missingVoiceMessages.first { message in
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", message)).firstMatch.exists
      }
    }
    let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      app.buttons["暂停"].firstMatch.exists || missingVoice() != nil
    }, object: app)
    guard XCTWaiter.wait(for: [ready], timeout: 120) == .completed else {
      throw ScenarioFailure.failed("System speech did not begin within 120 seconds. This is a failure, not an assumed missing-voice skip.")
    }
    if let message = missingVoice() {
      attach(app, name: "SKIP - simulator voice assets unavailable", note: message)
      throw XCTSkip("Simulator system voice assets unavailable: \(message). Audio behavior remains unverified.")
    }
    XCTAssertTrue(app.buttons["暂停"].firstMatch.exists)
  }

  @MainActor
  private func progressPercent(_ element: XCUIElement) throws -> Double {
    guard let value = element.value as? String else { throw ScenarioFailure.failed("Playback accessibilityValue must expose a percentage, not just a visual progress bar.") }
    // React Native Fabric emits NSNumberFormatterPercentStyle; the old renderer emits 'N percent'.
    // We request en_US, and also tolerate a decimal comma without interpreting seconds as percent.
    guard value.contains("%") || value.lowercased().contains("percent"),
          let range = value.range(of: "[0-9]+(?:[.,][0-9]+)?", options: .regularExpression),
          let number = Double(value[range].replacingOccurrences(of: ",", with: ".")),
          number >= 0, number <= 100 else {
      throw ScenarioFailure.failed("Unexpected adjustable progress value: \(value)")
    }
    return number
  }

  @MainActor
  private func waitForProgress(_ element: XCUIElement, greaterThan previous: Double, timeout: TimeInterval) throws {
    let advanced = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
      guard let current = try? self.progressPercent(element) else { return false }
      return current > previous
    }, object: element)
    guard XCTWaiter.wait(for: [advanced], timeout: timeout) == .completed else {
      throw ScenarioFailure.failed("Native audio progress did not advance beyond \(previous)% within \(timeout) seconds.")
    }
  }

  @MainActor
  private func attach(_ app: XCUIApplication, name: String, note: String? = nil) {
    XCTContext.runActivity(named: name) { activity in
      let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      screenshot.name = name
      screenshot.lifetime = .keepAlways
      activity.add(screenshot)
      if let note {
        let details = XCTAttachment(string: note)
        details.name = "\(name) - observations"
        details.lifetime = .keepAlways
        activity.add(details)
      }
    }
  }
}
