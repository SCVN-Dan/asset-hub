-- "Install Asset Hub": the small installer in the web .dmg (npm run dist:web). It downloads the newest
-- build for this Mac from the public release repo, checks it against its SHA-256, installs it into
-- Applications and opens it. Downloaded with curl, the app carries no quarantine flag, so macOS
-- opens it without the "unidentified developer" step. {{BASE_URL}} is filled in by the build script.

property baseURL : "{{BASE_URL}}"
property appName : "Asset Hub"

on run
	set work to ""
	try
		-- Built for Apple Silicon (M1–M4) only.
		if (do shell script "uname -m") is not "arm64" then error "Asset Hub runs on Macs with Apple silicon (M1, M2, M3, M4). This Mac has an Intel chip."
		-- The .tar.xz (about 30% smaller) when the release has one, else the .zip every release has.
		set zipName to "Asset-Hub-arm64.tar.xz"
		set packed to "xz"

		display dialog "This installer downloads the latest Asset Hub (about 60 MB) from GitHub and installs it in your Applications folder." buttons {"Cancel", "Install"} default button "Install" cancel button "Cancel" with title "Install Asset Hub" with icon note

		set work to do shell script "mktemp -d -t assethub"

		-- Size first, for the progress bar; then the download runs in the background while it is watched.
		set progress total steps to 100
		set progress completed steps to 0
		set progress description to "Connecting to GitHub…"
		set sizeOf to " | awk 'tolower($1)==\"content-length:\" {n=$2} END {gsub(/\\r/,\"\",n); print n+0}'"
		set total to 0
		try
			set total to (do shell script "curl -fsIL " & quoted form of (baseURL & zipName) & sizeOf) as integer
		end try
		if total is 0 then
			set zipName to "Asset-Hub-arm64.zip"
			set packed to "zip"
			set total to (do shell script "curl -fsIL " & quoted form of (baseURL & zipName) & sizeOf) as integer
		end if
		set zipURL to baseURL & zipName
		set zipPath to work & "/" & zipName
		-- A dropped connection is retried up to 3 times, resuming where it stopped (-C -). curl's own
		-- message goes to curl.log; the exit code is written aside and renamed into place, so "status"
		-- never exists half-written.
		set fetch to "for i in 1 2 3; do curl -fsSL -C - --connect-timeout 20 -o " & quoted form of zipPath & " " & quoted form of zipURL & " 2>> " & quoted form of (work & "/curl.log") & "; s=$?; [ $s = 0 ] && break; sleep 3; done; echo $s > " & quoted form of (work & "/status.part") & "; mv " & quoted form of (work & "/status.part") & " " & quoted form of (work & "/status")
		do shell script "(" & fetch & ") > /dev/null 2>&1 &"
		set progress description to "Downloading Asset Hub…"
		repeat
			delay 0.3
			set got to (do shell script "stat -f %z " & quoted form of zipPath & " 2>/dev/null || echo 0") as integer
			if total > 0 then set progress completed steps to (got * 100 div total)
			set progress additional description to (got div 1048576 as text) & " / " & (total div 1048576 as text) & " MB"
			if (do shell script "test -f " & quoted form of (work & "/status") & " && echo done || echo wait") is "done" then exit repeat
		end repeat
		set curlStatus to do shell script "cat " & quoted form of (work & "/status")
		if curlStatus is not "0" then
			set detail to do shell script "tail -n 1 " & quoted form of (work & "/curl.log") & " 2>/dev/null; true"
			error "Asset Hub could not be downloaded from GitHub (error " & curlStatus & "). Check your internet connection and try again." & return & return & detail
		end if

		-- Only a build that matches the checksum published next to it gets installed.
		set progress description to "Checking the download…"
		set progress additional description to ""
		set expected to do shell script "curl -fsSL " & quoted form of (zipURL & ".sha256") & " | awk '{print $1}'"
		set actual to do shell script "shasum -a 256 " & quoted form of zipPath & " | awk '{print $1}'"
		if expected is "" or expected is not actual then error "The download does not match its checksum, so it was not installed. Please try again later."

		-- Applications if this account may write there (admins can), else the user's own Applications.
		set progress description to "Installing into Applications…"
		set dest to "/Applications"
		try
			do shell script "test -w /Applications"
		on error
			set dest to (POSIX path of (path to home folder)) & "Applications"
			do shell script "mkdir -p " & quoted form of dest
		end try
		set appPath to dest & "/" & appName & ".app"
		do shell script "osascript -e 'tell application \"" & appName & "\" to quit' > /dev/null 2>&1; true"
		if packed is "xz" then
			do shell script "rm -rf " & quoted form of appPath & " && tar -xJf " & quoted form of zipPath & " -C " & quoted form of dest
		else
			do shell script "rm -rf " & quoted form of appPath & " && ditto -x -k " & quoted form of zipPath & " " & quoted form of dest
		end if
		do shell script "xattr -dr com.apple.quarantine " & quoted form of appPath & " 2>/dev/null; true"
		do shell script "rm -rf " & quoted form of work
		set progress completed steps to 100

		do shell script "open " & quoted form of appPath
		display dialog "Asset Hub is installed in " & dest & ". From now on, open it like any other app (you can delete this installer)." buttons {"Done"} default button "Done" with title "Install Asset Hub" with icon note giving up after 10
	on error message number code
		if work is not "" then do shell script "rm -rf " & quoted form of work
		if code is not -128 then display dialog message buttons {"Close"} default button "Close" with title "Install Asset Hub" with icon stop
	end try
end run
