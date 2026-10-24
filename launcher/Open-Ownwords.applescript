-- Open Ownwords: starts the Ownwords server for the folder this app sits in, then opens it.
-- REPO_PATH is filled in when the app is built (see build.sh).
property repoPath : "@REPO_PATH@"

on run
	set appPath to POSIX path of (path to me) -- ends with "Open Ownwords.app/"
	set folderPath to do shell script "/usr/bin/dirname " & quoted form of appPath
	try
		do shell script "/bin/sh " & quoted form of (repoPath & "/launcher/open-ownwords.sh") & " " & quoted form of folderPath
	on error msg number n
		display dialog "Ownwords could not start. Ask your agent to fix it, or try again." & return & msg buttons {"OK"} default button "OK" with icon caution
	end try
end run
