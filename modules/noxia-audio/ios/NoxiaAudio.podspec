Pod::Spec.new do |s|
  s.name = 'NoxiaAudio'
  s.version = '0.1.0'
  s.summary = 'Noxia private on-device speech rendering and background playback'
  s.description = 'System speech rendered into local PCM files, played by AVPlayer.'
  s.author = 'Noxia contributors'
  s.homepage = 'https://github.com/XiaoRui114514/noxia'
  s.license = { :type => 'MIT', :file => '../../../LICENSE' }
  s.platforms = { :ios => '16.4' }
  s.source = { :git => 'https://github.com/XiaoRui114514/noxia.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'MediaPlayer', 'CryptoKit'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
