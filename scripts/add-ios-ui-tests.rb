#!/usr/bin/env ruby
# Run after Expo prebuild/pod install, using the Ruby environment that provides CocoaPods.
# Only edits the generated .xcodeproj and its dedicated NoxiaUITests shared scheme.
require 'pathname'

begin
  require 'xcodeproj'
rescue LoadError
  abort 'Cannot load xcodeproj. Run with the existing CocoaPods Ruby environment (or bundle exec ruby when CocoaPods is bundled); this script installs no gems or Pods.'
end

abort 'Usage: ruby scripts/add-ios-ui-tests.rb [ios/Noxia.xcodeproj]' if ARGV.length > 1

repo_root = Pathname.new(__dir__).parent.expand_path
project_path = Pathname.new(ARGV.first || repo_root.join('ios/Noxia.xcodeproj').to_s).expand_path
source_path = repo_root.join('tests/ios/NoxiaUITests.swift')
abort "Missing generated project: #{project_path}. Run Expo prebuild for iOS first." unless project_path.join('project.pbxproj').file?
abort "Missing UI test source: #{source_path}" unless source_path.file?

project = Xcodeproj::Project.open(project_path)
application = project.targets.find do |target|
  target.name == 'Noxia' && target.product_type == 'com.apple.product-type.application'
end
abort 'Expected the Noxia application target; refusing to modify an unrelated project.' unless application

release_settings = application.build_configurations.find { |config| config.name == 'Release' }&.build_settings || {}
deployment_target = release_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '16.4'
bundle_identifier = release_settings['PRODUCT_BUNDLE_IDENTIFIER'] || 'com.noxia.app'
target_name = 'NoxiaUITests'
ui_test_type = Xcodeproj::Constants::PRODUCT_TYPE_UTI.fetch(:ui_test_bundle)
test_target = project.targets.find { |target| target.name == target_name }
abort "Existing #{target_name} is not a UI test bundle; refusing to replace it." if test_target && test_target.product_type != ui_test_type
test_target ||= project.new_target(:ui_test_bundle, target_name, :ios, deployment_target, nil, :swift)

# new_target's helper may hard-code its last-known iPhoneOS SDK in Foundation's path.
# Resolve against the selected simulator SDK instead; do not rewrite shared app references.
test_target.frameworks_build_phase.files.to_a.each do |build_file|
  build_file.remove_from_project if build_file.file_ref&.path&.end_with?('/Foundation.framework')
end
foundation_path = 'System/Library/Frameworks/Foundation.framework'
foundation = project.frameworks_group.files.find { |file| file.path == foundation_path && file.source_tree == 'SDKROOT' }
foundation ||= project.frameworks_group.new_file(foundation_path, 'SDKROOT')
test_target.frameworks_build_phase.add_file_reference(foundation, true)

test_target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'PRODUCT_BUNDLE_IDENTIFIER' => "#{bundle_identifier}.uitests",
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_KEY_CFBundleDisplayName' => target_name,
    'IPHONEOS_DEPLOYMENT_TARGET' => deployment_target,
    'TARGETED_DEVICE_FAMILY' => '2',
    'SUPPORTED_PLATFORMS' => 'iphonesimulator',
    'TEST_TARGET_NAME' => application.name,
    'SWIFT_VERSION' => '5.0',
    'CLANG_ENABLE_MODULES' => 'YES',
    'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'YES',
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks'],
    'CODE_SIGNING_ALLOWED' => 'NO',
    'CODE_SIGNING_REQUIRED' => 'NO'
  )
  # UI tests run in an external runner, unlike hosted unit tests.
  config.build_settings.delete('TEST_HOST')
  config.build_settings.delete('BUNDLE_LOADER')
end

relative_source_directory = source_path.parent.relative_path_from(project_path.parent).to_s
source_group = project.main_group.children.find { |child| child.isa == 'PBXGroup' && child.display_name == target_name }
source_group ||= project.main_group.new_group(target_name, relative_source_directory)
abort "Existing #{target_name} group points elsewhere; refusing to change it." unless source_group.real_path.expand_path == source_path.parent
source_reference = source_group.files.find { |file| file.path == source_path.basename.to_s }
source_reference ||= source_group.new_file(source_path.basename.to_s)
test_target.add_file_references([source_reference])
test_target.add_dependency(application)

attributes = project.root_object.attributes['TargetAttributes'] ||= {}
attributes[test_target.uuid] ||= {}
attributes[test_target.uuid]['TestTargetID'] = application.uuid
project.save

# Dedicated scheme avoids any stale template unit-test reference in the Expo app scheme.
# Recreate this owned scheme on every run so adding the test target is idempotent.
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(application, test_target, launch_target: true)
scheme.test_action.build_configuration = 'Release'
scheme.launch_action.build_configuration = 'Release'
scheme.analyze_action.build_configuration = 'Release'
scheme.profile_action.build_configuration = 'Release'
scheme.archive_action.build_configuration = 'Release'
scheme.save_as(project_path, target_name, true)

puts "Added #{target_name} (iPad simulator only), Release test scheme, and source: #{source_path}"
puts "xcodeproj #{Xcodeproj::VERSION}; no Podfile, application build settings, or signing credentials changed."
