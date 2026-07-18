# Build AAB (Android App Bundle) pour publication Play Store — sans Gradle
# Prerequis : ceux de build.ps1 + platforms;android-35 + bundletool.jar
#   (%LOCALAPPDATA%\Android\bundletool.jar, releases github.com/google/bundletool)
# Sortie : anime-tracker-vf.aab a la racine du repo (gitignore, ne pas publier sur le site)
$ErrorActionPreference = "Stop"

$sdk = "$env:LOCALAPPDATA\Android\Sdk"
$bundletool = "$env:LOCALAPPDATA\Android\bundletool.jar"
$proj = $PSScriptRoot
$repo = Split-Path $proj -Parent

$buildTools = (Get-ChildItem "$sdk\build-tools" | Sort-Object Name -Descending | Select-Object -First 1).FullName
$platform = (Get-ChildItem "$sdk\platforms" | Sort-Object Name -Descending | Select-Object -First 1).FullName
$androidJar = "$platform\android.jar"
Write-Host "build-tools: $buildTools"
Write-Host "platform: $platform"

$out = "$proj\out-aab"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out\classes", "$out\dex", "$out\module\manifest", "$out\module\dex" | Out-Null

# 1. Ressources compilees
& "$buildTools\aapt2.exe" compile --dir "$proj\res" -o "$out\res.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile a echoue" }

# 2. Link au format proto (requis pour les bundles)
& "$buildTools\aapt2.exe" link --proto-format -o "$out\proto.zip" -I $androidJar --manifest "$proj\AndroidManifest.xml" "$out\res.zip" --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link (proto) a echoue" }

# 3. Java -> dex
& javac --release 8 -classpath $androidJar -d "$out\classes" "$proj\src\com\app\animetracker\MainActivity.java"
if ($LASTEXITCODE -ne 0) { throw "javac a echoue" }
$classFiles = Get-ChildItem "$out\classes" -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& "$buildTools\d8.bat" --release --lib $androidJar --min-api 24 --output "$out\dex" @classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 a echoue" }

# 4. Reorganiser au format module de bundle
Expand-Archive -Path "$out\proto.zip" -DestinationPath "$out\proto" -Force
Copy-Item "$out\proto\AndroidManifest.xml" "$out\module\manifest\AndroidManifest.xml"
Copy-Item "$out\proto\resources.pb" "$out\module\resources.pb"
Copy-Item "$out\proto\res" "$out\module\res" -Recurse
Copy-Item "$out\dex\classes.dex" "$out\module\dex\classes.dex"

# 5. Zipper le module (jar = entrees avec des slashs, requis par bundletool)
Push-Location "$out\module"
& jar cMf "$out\base.zip" .
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "jar cMf a echoue" }
Pop-Location

# 6. Construire le bundle
& java -jar $bundletool build-bundle --modules="$out\base.zip" --output="$out\anime-tracker-vf.aab" --overwrite
if ($LASTEXITCODE -ne 0) { throw "bundletool build-bundle a echoue" }

# 7. Signer (les AAB se signent avec jarsigner, meme keystore que l'APK)
# -storepass:env / -keypass:env lisent le mot de passe depuis une variable
# d'environnement du processus au lieu d'un argument CLI en clair (visible
# dans la liste des processus pendant toute la duree de l'appel).
$passLine = (Get-Content "$repo\keystore-info.txt" | Select-String "Password").Line
$env:AT_KS_PASS = $passLine.Split(":")[1].Trim()
try {
    & jarsigner -keystore "$repo\release.keystore" -storepass:env AT_KS_PASS -keypass:env AT_KS_PASS -digestalg SHA-256 -sigalg SHA256withRSA "$out\anime-tracker-vf.aab" animetrackervf
    if ($LASTEXITCODE -ne 0) { throw "jarsigner a echoue" }
} finally {
    Remove-Item Env:\AT_KS_PASS -ErrorAction SilentlyContinue
}

# 8. Valider
& java -jar $bundletool validate --bundle "$out\anime-tracker-vf.aab" | Select-Object -First 15
if ($LASTEXITCODE -ne 0) { throw "validation bundletool a echoue" }

Copy-Item "$out\anime-tracker-vf.aab" "$repo\anime-tracker-vf.aab" -Force
Get-Item "$repo\anime-tracker-vf.aab" | Select-Object Name, Length
Write-Host "AAB PRET : $repo\anime-tracker-vf.aab"
