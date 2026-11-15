import ExpoModulesCore
import AVFoundation
import MediaPlayer
import CryptoKit

private struct Plan: Decodable {
  let id: String
  let title: String
  let author: String?
  let steps: [Step]
  let loop: Bool
  let pronunciations: [String: String]?
}

private struct Step: Decodable {
  let id: String
  let segmentId: String
  let kind: String
  let uri: String?
  let text: String?
  let durationMs: Double?
  let voiceId: String?
  let rate: Double
  let volume: Double
  let resourceId: String?
  let title: String?
  let author: String?
}

private enum AudioFailure: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self { case .message(let value): return value }
  }
}

/// Writes only one utterance at a time, without retaining full PCM audio in memory.
private final class SpeechRenderer: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var completion: CheckedContinuation<Void, Error>?
  private var file: AVAudioFile?
  private var generation = 0
  private var currentUtterance: AVSpeechUtterance?
  private var watchdog: DispatchWorkItem?

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  @MainActor
  func render(_ utterance: AVSpeechUtterance, to url: URL) async throws {
    guard completion == nil else { throw AudioFailure.message("A speech render is already running.") }
    generation += 1
    let token = generation
    try await withCheckedThrowingContinuation { continuation in
      completion = continuation
      currentUtterance = utterance
      let timeout = DispatchWorkItem { [weak self] in
        guard let self, self.generation == token else { return }
        self.generation += 1
        self.synthesizer.stopSpeaking(at: .immediate)
        self.finish(AudioFailure.message("系统语音生成超时，请换用另一种已安装的音色或缩短段落。"))
      }
      watchdog = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: timeout)
      synthesizer.write(utterance) { [weak self] buffer in
        DispatchQueue.main.async {
          guard let self, self.generation == token, self.completion != nil else { return }
          guard let pcm = buffer as? AVAudioPCMBuffer else {
            self.finish(AudioFailure.message("The system voice returned an unsupported audio format."))
            return
          }
          if pcm.frameLength == 0 {
            let missing = self.file == nil
            self.finish(missing ? AudioFailure.message("This system voice produced no audio. Download a voice in iPad Settings.") : nil)
            return
          }
          do {
            if self.file == nil {
              self.file = try AVAudioFile(forWriting: url, settings: pcm.format.settings)
            }
            try self.file?.write(from: pcm)
          } catch { self.finish(error) }
        }
      }
    }
  }

  private func finish(_ error: Error?) {
    guard let continuation = completion else { return }
    completion = nil
    currentUtterance = nil
    watchdog?.cancel()
    watchdog = nil
    file = nil // Flush/close the file before the composition reads it.
    if let error { continuation.resume(throwing: error) }
    else { continuation.resume(returning: ()) }
  }

  func cancel() {
    generation += 1
    synthesizer.stopSpeaking(at: .immediate)
    finish(CancellationError())
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    DispatchQueue.main.async { [weak self] in
      guard let self, self.currentUtterance === utterance else { return }
      self.finish(CancellationError())
    }
  }
}

private final class AudioEngine {
  var onStatus: (([String: Any]) -> Void)?
  private let player = AVPlayer()
  private let renderer = SpeechRenderer()
  private var plan: Plan?
  private var ranges: [(start: Double, end: Double)] = []
  private var duration = 0.0
  private var generation = 0
  private var preparing = false
  private var externalWrites = 0
  private var cachedCount = 0
  private var preparedCount = 0
  private var totalSteps = 0
  private var errorMessage: String?
  private var playbackRate: Float = 1
  private var wantsPlayback = false
  private var interrupted = false
  private var sleepDeadline: Date?
  private var fadeSeconds = 0.0
  private var sleepTimer: Timer?
  private var sleepBoundary: Any?
  private var periodicObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var itemObservation: NSKeyValueObservation?
  private var observers: [NSObjectProtocol] = []
  private var remoteTargets: [(MPRemoteCommand, Any)] = []
  private var lastPersist = Date.distantPast
  private var lastMetadataStepIndex = -1
  private let storeKey = "noxia.audio.resume.v1"

  init() {
    player.automaticallyWaitsToMinimizeStalling = false
    periodicObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] _ in
      self?.tick()
    }
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
      self?.handleInterruption(notification)
    })
    observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
      guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
            AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
      self?.pause()
    })
    observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
      self?.pause()
      self?.errorMessage = "系统音频服务已重置，请重新准备当前内容。"
      self?.emit()
    })
    configureRemoteCommands()
  }

  deinit {
    if let periodicObserver { player.removeTimeObserver(periodicObserver) }
    if let sleepBoundary { player.removeTimeObserver(sleepBoundary) }
    sleepTimer?.invalidate()
    if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    for (command, target) in remoteTargets { command.removeTarget(target) }
  }

  private var cacheDirectory: URL {
    get throws {
      let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      var directory = root.appendingPathComponent("Noxia/Audio", isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try directory.setResourceValues(values)
      return directory
    }
  }

  /// Restrict file steps to actual regular audio files within this app's private
  /// canonical cache directory. Resolving symlinks prevents an in-cache alias
  /// from exposing arbitrary files, and the trailing slash prevents prefix matches.
  private func validatedCachedAudioURL(_ raw: String) throws -> URL {
    guard let candidate = URL(string: raw), candidate.isFileURL,
          candidate.host == nil || candidate.host == "" else {
      throw AudioFailure.message("仅允许本应用音频缓存内的本地文件。")
    }
    let directory = try cacheDirectory.standardizedFileURL.resolvingSymlinksInPath()
    let canonical = candidate.standardizedFileURL.resolvingSymlinksInPath()
    guard canonical.path.hasPrefix(directory.path + "/"),
          ["mp3", "caf"].contains(canonical.pathExtension.lowercased()),
          !canonical.lastPathComponent.contains(".partial."),
          try canonical.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
      throw AudioFailure.message("音频文件不在本应用缓存内、格式不支持或已不存在。")
    }
    return canonical
  }

  private func externalAudioDestination(_ key: String) throws -> URL {
    guard key.utf8.count == 64, key.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil else {
      throw AudioFailure.message("音频缓存键须为 64 位十六进制摘要。")
    }
    return try cacheDirectory.appendingPathComponent("external-\(key.lowercased()).mp3")
  }

  func getExternalAudio(_ key: String) throws -> [String: Any]? {
    let destination = try externalAudioDestination(key)
    guard FileManager.default.fileExists(atPath: destination.path) else { return nil }
    let url = try validatedCachedAudioURL(destination.absoluteString)
    let bytes = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard bytes > 0, bytes <= 10 * 1024 * 1024 else {
      throw AudioFailure.message("已缓存的外部音频无效，请清理后重新生成。")
    }
    return ["uri": url.absoluteString]
  }

  @MainActor
  func cacheExternalAudio(_ base64: String, key: String) async throws -> [String: Any] {
    let destination = try externalAudioDestination(key)
    let maximumBytes = 10 * 1024 * 1024
    guard !base64.isEmpty, base64.utf8.count <= ((maximumBytes + 2) / 3) * 4 else {
      throw AudioFailure.message("单段 MP3 音频不得超过 10 MiB。")
    }
    if let cached = try getExternalAudio(key) { return cached }
    guard let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= maximumBytes else {
      throw AudioFailure.message("音频不是有效的 Base64 或超过 10 MiB。")
    }
    // Reject common non-audio error pages before asking the system media parser.
    let hasID3 = data.count >= 3 && data.prefix(3).elementsEqual([0x49, 0x44, 0x33])
    let hasFrame = data.count >= 2 && data[data.startIndex] == 0xff && (data[data.startIndex + 1] & 0xe0) == 0xe0
    guard hasID3 || hasFrame else { throw AudioFailure.message("语音服务未返回 MP3 音频。") }
    let temporary = destination.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".partial.mp3")
    externalWrites += 1
    defer { externalWrites -= 1; try? FileManager.default.removeItem(at: temporary) }
    try data.write(to: temporary, options: .atomic)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
    let asset = AVURLAsset(url: temporary)
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    let audioDuration = try await asset.load(.duration)
    guard !tracks.isEmpty, audioDuration.seconds.isFinite, audioDuration.seconds > 0, audioDuration.seconds <= 8 * 3600 else {
      throw AudioFailure.message("语音服务返回的音频无效或时长超限。")
    }
    // Another request for this identity may have finished while the parser awaited.
    if let cached = try getExternalAudio(key) { return cached }
    try FileManager.default.moveItem(at: temporary, to: destination)
    return ["uri": destination.absoluteString]
  }

  func listVoices() -> [[String: Any]] {
    AVSpeechSynthesisVoice.speechVoices().map { voice in
      let gender: String
      switch voice.gender {
      case .male: gender = "male"
      case .female: gender = "female"
      default: gender = "unspecified"
      }
      return ["id": voice.identifier, "name": voice.name, "language": voice.language, "gender": gender,
       "quality": voice.quality == .enhanced ? "enhanced" : (voice.quality.rawValue > AVSpeechSynthesisVoiceQuality.enhanced.rawValue ? "premium" : "default")]
    }
  }

  @MainActor
  func prepare(_ dictionary: [String: Any]) async throws -> [String: Any] {
    guard !preparing else { throw AudioFailure.message("正在准备语音，请先停止或等待完成。") }
    let data = try JSONSerialization.data(withJSONObject: dictionary)
    let nextPlan = try JSONDecoder().decode(Plan.self, from: data)
    guard !nextPlan.id.isEmpty, !nextPlan.steps.isEmpty, nextPlan.steps.count <= 1000 else {
      throw AudioFailure.message("播放计划须包含 1–1000 个步骤。")
    }
    guard nextPlan.steps.reduce(0, { $0 + ($1.text?.count ?? 0) }) <= 150_000 else {
      throw AudioFailure.message("单次计划文字超过 15 万字，请拆成多个列表条目。")
    }
    guard (nextPlan.pronunciations?.count ?? 0) <= 500,
          (nextPlan.pronunciations ?? [:]).allSatisfy({ !$0.key.isEmpty && $0.key.count <= 100 && $0.value.count <= 200 }) else {
      throw AudioFailure.message("读音字典过大或包含无效条目。")
    }
    pause()
    setSleepTimer(seconds: 0, fade: 0)
    generation += 1
    let token = generation
    preparing = true
    cachedCount = 0
    preparedCount = 0
    totalSteps = nextPlan.steps.count
    errorMessage = nil
    emit()
    defer { preparing = false; emit() }
    let composition = AVMutableComposition()
    guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      throw AudioFailure.message("无法创建音频轨道。")
    }
    let volumeParameters = AVMutableAudioMixInputParameters(track: track)
    var cursor = CMTime.zero
    var nextRanges: [(start: Double, end: Double)] = []
    do {
      for step in nextPlan.steps {
        guard generation == token else { throw CancellationError() }
        guard step.rate.isFinite, step.volume.isFinite, step.rate >= 0.25, step.rate <= 2, step.volume >= 0, step.volume <= 1 else {
          throw AudioFailure.message("步骤语速或音量超出范围。")
        }
        let url: URL
        if step.kind == "silence" {
          let milliseconds = step.durationMs ?? 0
          guard milliseconds.isFinite, milliseconds >= 50, milliseconds <= 600_000 else {
            throw AudioFailure.message("单次留白须为 0.05–600 秒。")
          }
          url = try makeSilence(milliseconds: milliseconds)
        } else if step.kind == "speech" {
          guard let source = step.text, !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, source.count <= 10_000 else {
            throw AudioFailure.message("朗读步骤须包含 1–10000 字。")
          }
          var text = source
          for (word, replacement) in (nextPlan.pronunciations ?? [:]).sorted(by: { $0.key.count > $1.key.count }) {
            text = text.replacingOccurrences(of: word, with: replacement)
          }
          let voice: AVSpeechSynthesisVoice?
          if let identifier = step.voiceId, !identifier.isEmpty {
            guard let selected = AVSpeechSynthesisVoice(identifier: identifier) else {
              throw AudioFailure.message("所选音色未安装，请重新选择系统声音。")
            }
            voice = selected
          } else {
            let chinese = text.range(of: "[\\p{Han}]", options: .regularExpression) != nil
            voice = AVSpeechSynthesisVoice(language: chinese ? "zh-CN" : "en-US")
          }
          guard let voice else { throw AudioFailure.message("请先在 iPad 设置中安装中文或英语系统声音。") }
          let utterance = AVSpeechUtterance(string: text)
          utterance.voice = voice
          utterance.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, AVSpeechUtteranceDefaultSpeechRate * Float(step.rate)))
          utterance.volume = Float(step.volume)
          // Include synthesis implementation, OS version and effective parameters. Repeat count is deliberately absent.
          let key: [String: Any] = ["text": text, "original": source, "voice": voice.identifier,
            "rate": utterance.rate, "volume": utterance.volume, "model": "apple-avspeech-pcm-v1",
            "os": ProcessInfo.processInfo.operatingSystemVersionString, "pronunciations": nextPlan.pronunciations ?? [:]]
          let keyData = try JSONSerialization.data(withJSONObject: key, options: .sortedKeys)
          let hash = SHA256.hash(data: keyData).map { String(format: "%02x", $0) }.joined()
          url = try cacheDirectory.appendingPathComponent(hash + ".caf")
          if FileManager.default.fileExists(atPath: url.path) {
            cachedCount += 1
          } else {
            let temporary = url.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".partial.caf")
            do {
              try await renderer.render(utterance, to: temporary)
              guard generation == token else { throw CancellationError() }
              try FileManager.default.moveItem(at: temporary, to: url)
              try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            } catch {
              try? FileManager.default.removeItem(at: temporary)
              throw error
            }
          }
        } else if step.kind == "file" {
          guard let uri = step.uri else { throw AudioFailure.message("音频步骤缺少本地缓存地址。") }
          url = try validatedCachedAudioURL(uri)
          cachedCount += 1
        } else { throw AudioFailure.message("未知的编排步骤。") }
        let asset = AVURLAsset(url: url)
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        let assetDuration = try await asset.load(.duration)
        guard generation == token else { throw CancellationError() }
        guard let sourceTrack = tracks.first, assetDuration.seconds.isFinite, assetDuration.seconds > 0 else {
          try? FileManager.default.removeItem(at: url)
          throw AudioFailure.message("本地音频损坏，请重新准备。")
        }
        let start = cursor.seconds
        // System speech volume is already baked into PCM; apply a mix gain only
        // to external files. Their requested synthesis rate is also already baked in.
        volumeParameters.setVolume(step.kind == "file" ? Float(step.volume) : 1, at: cursor)
        try track.insertTimeRange(CMTimeRange(start: .zero, duration: assetDuration), of: sourceTrack, at: cursor)
        cursor = CMTimeAdd(cursor, assetDuration)
        guard cursor.seconds <= 8 * 3600 else { throw AudioFailure.message("单次播放计划超过 8 小时，请拆分内容。") }
        nextRanges.append((start: start, end: cursor.seconds))
        preparedCount = nextRanges.count
        emit()
      }
      guard generation == token else { throw CancellationError() }
      if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
      itemObservation = nil
      let item = AVPlayerItem(asset: composition)
      let mix = AVMutableAudioMix()
      mix.inputParameters = [volumeParameters]
      item.audioMix = mix
      player.replaceCurrentItem(with: item)
      plan = nextPlan
      ranges = nextRanges
      duration = cursor.seconds
      lastMetadataStepIndex = -1
      endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
        guard let self else { return }
        if self.sleepExpired { self.finishSleep(); return }
        if self.plan?.loop == true && self.wantsPlayback {
          self.player.seek(to: .zero) { [weak self] completed in
            DispatchQueue.main.async { if completed { self?.play() } }
          }
        } else { self.pause() }
      }
      itemObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
        if item.status == .failed {
          DispatchQueue.main.async {
            self?.errorMessage = item.error?.localizedDescription ?? "播放失败，请重新准备。"
            self?.pause()
          }
        }
      }
      if let resume = UserDefaults.standard.dictionary(forKey: storeKey), resume["id"] as? String == nextPlan.id,
         let position = resume["position"] as? Double, position > 0, position < duration - 0.5 {
        seek(position)
      }
      updateNowPlaying()
      return ["duration": duration]
    } catch {
      if !(error is CancellationError) { errorMessage = error.localizedDescription }
      throw error
    }
  }

  private func makeSilence(milliseconds: Double) throws -> URL {
    let frames = Int64((milliseconds / 1000 * 22050).rounded())
    let url = try cacheDirectory.appendingPathComponent("silence-22050-\(frames)-v1.caf")
    if FileManager.default.fileExists(atPath: url.path) { return url }
    let temporary = url.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".partial.caf")
    do {
      guard let format = AVAudioFormat(standardFormatWithSampleRate: 22050, channels: 1),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 22050), let samples = buffer.floatChannelData?[0] else {
        throw AudioFailure.message("无法创建留白音频。")
      }
      samples.initialize(repeating: 0, count: 22050)
      var file: AVAudioFile? = try AVAudioFile(forWriting: temporary, settings: format.settings)
      var remaining = frames
      while remaining > 0 {
        buffer.frameLength = AVAudioFrameCount(min(22050, remaining))
        try file?.write(from: buffer)
        remaining -= Int64(buffer.frameLength)
      }
      file = nil
      try FileManager.default.moveItem(at: temporary, to: url)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
      return url
    } catch { try? FileManager.default.removeItem(at: temporary); throw error }
  }

  func play() {
    guard let item = player.currentItem, !preparing else { return }
    if sleepExpired { finishSleep(); return }
    do {
      let session = AVAudioSession.sharedInstance()
      // Playback already supports AirPlay/A2DP. Options intended for playAndRecord
      // can make setCategory fail on some iPadOS releases.
      try session.setCategory(.playback, mode: .spokenAudio, options: [])
      try session.setActive(true)
      wantsPlayback = true
      if position >= duration - 0.05 {
        let token = generation
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
          DispatchQueue.main.async {
            guard let self, completed, self.wantsPlayback, !self.preparing,
                  self.generation == token, self.player.currentItem === item else { return }
            if self.sleepExpired { self.finishSleep(); return }
            // A seek is asynchronous. Start only after it succeeds, and do not
            // recursively call play(): a very short item may still meet its EOF threshold.
            self.player.playImmediately(atRate: self.playbackRate)
            self.scheduleSleepBoundary()
            self.updateNowPlaying()
            self.emit()
          }
        }
        return
      }
      player.playImmediately(atRate: playbackRate)
      scheduleSleepBoundary()
      updateNowPlaying()
      emit()
    } catch { errorMessage = error.localizedDescription; wantsPlayback = false; emit() }
  }

  func pause() {
    wantsPlayback = false
    player.pause()
    persist()
    updateNowPlaying()
    emit()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  func stop() {
    generation += 1
    renderer.cancel()
    pause()
    setSleepTimer(seconds: 0, fade: 0)
    seek(0)
    persist(position: 0)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  func shutdown() {
    generation += 1
    renderer.cancel()
    pause() // Preserve the resume position when the Expo runtime is destroyed.
    setSleepTimer(seconds: 0, fade: 0)
  }

  func seek(_ seconds: Double) {
    guard seconds.isFinite, duration > 0 else { return }
    player.seek(to: CMTime(seconds: max(0, min(duration, seconds)), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] completed in
      DispatchQueue.main.async {
        guard let self, completed else { return }
        // AVPlayer seeks asynchronously; calculate from the final media position
        // and the wall-clock time still remaining, never from the old position.
        self.scheduleSleepBoundary()
        self.persist()
        self.updateNowPlaying()
        self.emit()
      }
    }
  }

  func setRate(_ rate: Double) {
    guard rate.isFinite else { return }
    playbackRate = Float(max(0.25, min(2, rate)))
    if wantsPlayback { player.rate = playbackRate }
    scheduleSleepBoundary()
    updateNowPlaying()
  }

  func skipStep(_ index: Int) {
    guard !ranges.isEmpty else { return }
    seek(ranges[max(0, min(ranges.count - 1, index))].start)
  }

  func setSleepTimer(seconds: Double, fade: Double) {
    sleepTimer?.invalidate()
    sleepTimer = nil
    sleepDeadline = seconds.isFinite && seconds > 0 ? Date().addingTimeInterval(min(seconds, 24 * 3600)) : nil
    fadeSeconds = fade.isFinite ? max(0, min(fade, max(0, seconds))) : 0
    player.volume = 1
    if sleepDeadline != nil {
      let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in self?.checkSleep() }
      RunLoop.main.add(timer, forMode: .common)
      sleepTimer = timer
    }
    scheduleSleepBoundary()
  }

  private func scheduleSleepBoundary() {
    if let sleepBoundary { player.removeTimeObserver(sleepBoundary); self.sleepBoundary = nil }
    guard let deadline = sleepDeadline else { return }
    let remaining = max(0, deadline.timeIntervalSinceNow)
    let target = position + remaining * Double(playbackRate)
    guard target < duration else { return }
    sleepBoundary = player.addBoundaryTimeObserver(forTimes: [NSValue(time: CMTime(seconds: target, preferredTimescale: 600))], queue: .main) { [weak self] in
      self?.checkSleep()
    }
  }

  private var sleepExpired: Bool { sleepDeadline.map { $0 <= Date() } ?? false }

  private func checkSleep() {
    guard let deadline = sleepDeadline else { return }
    let remaining = deadline.timeIntervalSinceNow
    if remaining <= 0 { finishSleep() }
    else if fadeSeconds > 0 && remaining < fadeSeconds { player.volume = Float(remaining / fadeSeconds) }
  }

  private func finishSleep() {
    pause()
    setSleepTimer(seconds: 0, fade: 0)
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private var position: Double {
    let seconds = player.currentTime().seconds
    return seconds.isFinite ? max(0, seconds) : 0
  }

  func status() -> [String: Any] {
    let stepIndex = currentStepIndex
    let currentPosition = position
    var resourceStart = 0.0
    var resourceEnd = duration
    var result: [String: Any] = ["playing": player.rate != 0, "position": position, "duration": duration,
      "stepIndex": stepIndex, "preparing": preparing, "cachedCount": cachedCount, "preparedCount": preparedCount, "totalSteps": totalSteps]
    if let errorMessage { result["error"] = errorMessage }
    if let plan, stepIndex < plan.steps.count, let resourceId = plan.steps[stepIndex].resourceId {
      result["resourceId"] = resourceId
      var first = stepIndex
      var last = stepIndex
      while first > 0 && plan.steps[first - 1].resourceId == resourceId { first -= 1 }
      while last < plan.steps.count - 1 && plan.steps[last + 1].resourceId == resourceId { last += 1 }
      if first < ranges.count, last < ranges.count {
        resourceStart = ranges[first].start
        resourceEnd = ranges[last].end
      }
    }
    let resourceDuration = max(0, resourceEnd - resourceStart)
    result["resourceDuration"] = resourceDuration
    result["resourcePosition"] = max(0, min(resourceDuration, currentPosition - resourceStart))
    return result
  }

  private func tick() {
    checkSleep()
    if currentStepIndex != lastMetadataStepIndex { updateNowPlaying() }
    if Date().timeIntervalSince(lastPersist) > 2 { persist(); updateNowPlaying() }
    emit()
  }

  private func emit() { onStatus?(status()) }

  private func persist(position savedPosition: Double? = nil) {
    guard let plan else { return }
    // Only the resume marker is persisted here; content remains in the app's local database.
    UserDefaults.standard.set(["id": plan.id, "position": savedPosition ?? position], forKey: storeKey)
    lastPersist = Date()
  }

  private func updateNowPlaying() {
    guard let plan else { return }
    let index = currentStepIndex
    let step = index < plan.steps.count ? plan.steps[index] : nil
    lastMetadataStepIndex = index
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [
      MPMediaItemPropertyTitle: step?.title ?? plan.title,
      MPMediaItemPropertyArtist: step?.author ?? plan.author ?? "Noxia",
      MPMediaItemPropertyPlaybackDuration: duration,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
      MPNowPlayingInfoPropertyPlaybackRate: player.rate,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: playbackRate,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      MPNowPlayingInfoPropertyIsLiveStream: false
    ]
  }

  private var currentStepIndex: Int {
    ranges.firstIndex(where: { position < $0.end }) ?? max(0, ranges.count - 1)
  }

  private func configureRemoteCommands() {
    let commands = MPRemoteCommandCenter.shared()
    func bind(_ command: MPRemoteCommand, _ action: @escaping (MPRemoteCommandEvent) -> Void) {
      command.isEnabled = true
      let target = command.addTarget { [weak self] event in
        guard self?.plan != nil else { return .noSuchContent }
        DispatchQueue.main.async { action(event) }
        return .success
      }
      remoteTargets.append((command, target))
    }
    bind(commands.playCommand) { [weak self] _ in self?.play() }
    bind(commands.pauseCommand) { [weak self] _ in self?.pause() }
    bind(commands.stopCommand) { [weak self] _ in self?.stop() }
    bind(commands.togglePlayPauseCommand) { [weak self] _ in
      guard let self else { return }
      if self.wantsPlayback { self.pause() } else { self.play() }
    }
    bind(commands.nextTrackCommand) { [weak self] _ in self?.skipSegment(forward: true) }
    bind(commands.previousTrackCommand) { [weak self] _ in self?.skipSegment(forward: false) }
    bind(commands.changePlaybackPositionCommand) { [weak self] event in
      guard let event = event as? MPChangePlaybackPositionCommandEvent else { return }
      self?.seek(event.positionTime)
    }
    commands.skipForwardCommand.preferredIntervals = [15]
    commands.skipBackwardCommand.preferredIntervals = [15]
    bind(commands.skipForwardCommand) { [weak self] _ in guard let self else { return }; self.seek(self.position + 15) }
    bind(commands.skipBackwardCommand) { [weak self] _ in guard let self else { return }; self.seek(self.position - 15) }
  }

  private func skipSegment(forward: Bool) {
    guard let plan, !ranges.isEmpty else { return }
    let current = ranges.firstIndex(where: { position < $0.end }) ?? ranges.count - 1
    func sameSegment(_ lhs: Int, _ rhs: Int) -> Bool {
      plan.steps[lhs].segmentId == plan.steps[rhs].segmentId && plan.steps[lhs].resourceId == plan.steps[rhs].resourceId
    }
    if forward {
      if let index = plan.steps.indices.first(where: { $0 > current && !sameSegment($0, current) }) { seek(ranges[index].start) }
      else if plan.loop { seek(0) } else { pause(); seek(duration) }
    } else {
      var currentStart = current
      while currentStart > 0 && sameSegment(currentStart - 1, current) { currentStart -= 1 }
      if position - ranges[currentStart].start > 3 { seek(ranges[currentStart].start); return }
      guard currentStart > 0 else { seek(0); return }
      var index = currentStart - 1
      while index > 0 && sameSegment(index - 1, currentStart - 1) { index -= 1 }
      seek(ranges[index].start)
    }
  }

  private func handleInterruption(_ notification: Notification) {
    guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
    if type == .began {
      interrupted = wantsPlayback
      player.pause()
      persist()
      updateNowPlaying()
      emit()
    } else {
      let optionsRaw = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
      if interrupted && wantsPlayback && shouldResume && !sleepExpired { play() }
      else { pause() }
      interrupted = false
    }
  }

  func getCacheInfo() throws -> [String: Any] {
    let files = try FileManager.default.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: [.fileSizeKey])
    var bytes = 0
    for file in files { bytes += (try file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0 }
    return ["count": files.filter { !$0.lastPathComponent.contains("partial") }.count, "bytes": bytes]
  }

  func clearCache() throws {
    guard !preparing, externalWrites == 0, player.rate == 0 else { throw AudioFailure.message("请先停止播放并等待语音准备或缓存完成。") }
    wantsPlayback = false
    interrupted = false
    setSleepTimer(seconds: 0, fade: 0)
    itemObservation = nil
    if let endObserver { NotificationCenter.default.removeObserver(endObserver); self.endObserver = nil }
    player.replaceCurrentItem(with: nil)
    plan = nil
    ranges = []
    duration = 0
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    let directory = try cacheDirectory
    for url in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
      try FileManager.default.removeItem(at: url)
    }
    emit()
  }
}

public final class NoxiaAudioModule: Module {
  private var engine: AudioEngine?

  private func onMain<T>(_ body: () -> T) -> T {
    if Thread.isMainThread { return body() }
    return DispatchQueue.main.sync(execute: body)
  }

  private func audio() -> AudioEngine {
    if let engine { return engine }
    let created = AudioEngine()
    created.onStatus = { [weak self] status in self?.sendEvent("onStatus", status) }
    engine = created
    return created
  }

  public func definition() -> ModuleDefinition {
    Name("NoxiaAudio")
    Events("onStatus")

    AsyncFunction("listVoices") { () -> [[String: Any]] in self.onMain { self.audio().listVoices() } }
    AsyncFunction("prepare") { (plan: [String: Any], promise: Promise) in
      Task { @MainActor in
        do { promise.resolve(try await self.audio().prepare(plan)) }
        catch { promise.reject("ERR_NOXIA_AUDIO", error.localizedDescription) }
      }
    }
    AsyncFunction("cacheExternalAudio") { (base64: String, key: String, promise: Promise) in
      Task { @MainActor in
        do { promise.resolve(try await self.audio().cacheExternalAudio(base64, key: key)) }
        catch { promise.reject("ERR_NOXIA_CACHE", error.localizedDescription) }
      }
    }
    AsyncFunction("getExternalAudio") { (key: String, promise: Promise) in
      self.onMain {
        do { promise.resolve(try self.audio().getExternalAudio(key)) }
        catch { promise.reject("ERR_NOXIA_CACHE", error.localizedDescription) }
      }
    }
    Function("play") { self.onMain { self.audio().play() } }
    Function("pause") { self.onMain { self.audio().pause() } }
    Function("stop") { self.onMain { self.audio().stop() } }
    Function("seek") { (seconds: Double) in self.onMain { self.audio().seek(seconds) } }
    Function("skipStep") { (index: Int) in self.onMain { self.audio().skipStep(index) } }
    Function("setRate") { (rate: Double) in self.onMain { self.audio().setRate(rate) } }
    Function("setSleepTimer") { (seconds: Double, fade: Double) in self.onMain { self.audio().setSleepTimer(seconds: seconds, fade: fade) } }
    Function("getStatus") { () -> [String: Any] in self.onMain { self.audio().status() } }
    AsyncFunction("getCacheInfo") { (promise: Promise) in
      self.onMain {
        do { promise.resolve(try self.audio().getCacheInfo()) }
        catch { promise.reject("ERR_NOXIA_CACHE", error.localizedDescription) }
      }
    }
    AsyncFunction("clearCache") { (promise: Promise) in
      self.onMain {
        do { try self.audio().clearCache(); promise.resolve(nil) }
        catch { promise.reject("ERR_NOXIA_CACHE", error.localizedDescription) }
      }
    }
    OnDestroy { self.onMain { self.engine?.shutdown(); self.engine = nil } }
  }
}
