# Run after Gradle compileDebugUnitTestKotlin. This avoids a Gradle/JDK argument-file
# encoding issue on Windows when the repository path contains Chinese characters.
param([string]$GradleHome = $env:GRADLE_USER_HOME)
$ErrorActionPreference='Stop'
if(-not $GradleHome){$GradleHome=Join-Path $HOME '.gradle'}
if(-not $env:JAVA_HOME){throw 'Set JAVA_HOME to JDK 21'}
$libraries=@()
foreach($group in @('org.json/json','junit/junit','org.hamcrest/hamcrest-core','org.jetbrains.kotlin/kotlin-stdlib')) {
  $base=Join-Path $GradleHome ('caches/modules-2/files-2.1/'+$group)
  $version=Get-ChildItem $base -Directory | Sort-Object Name -Descending | Select-Object -First 1
  $libraries+=(Get-ChildItem $version.FullName -Recurse -Filter '*.jar' | Select-Object -First 1).FullName
}
$paths=@((Resolve-Path 'apps/android/android/app/build/tmp/kotlin-classes/debug').Path,(Resolve-Path 'apps/android/android/app/build/tmp/kotlin-classes/debugUnitTest').Path,(Resolve-Path 'tests/fixtures').Path)+$libraries
& (Join-Path $env:JAVA_HOME 'bin/java.exe') -cp ($paths -join ';') org.junit.runner.JUnitCore dev.subtitle.workbench.ProtocolTest
exit $LASTEXITCODE
