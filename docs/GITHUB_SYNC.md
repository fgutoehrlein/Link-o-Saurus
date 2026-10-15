# GitHub Sync setup

GitHub Sync is an explicit push/pull feature in the Options page. It uploads an encrypted JSON snapshot to a private repository. Bookmarks, boards, categories, tags, comments, read-later entries, and saved sessions are included. Browser bookmark IDs, sync mappings, rules, preferences, and local caches are not.

Each PC must use the same passphrase. It is never saved by the extension. Losing it means the encrypted repository file cannot be recovered.

## Connect with a fine-grained token

Create a fine-grained personal access token restricted to the private repository you want to use. Grant Contents read/write. GitHub’s repository list endpoint may also require Metadata read. Paste the token into Options and choose the repository, branch, and JSON path. The token is stored in that browser profile’s extension-local storage and is never put into the sync file.

## Connect with GitHub

GitHub App device login is enabled only when the extension is built with a registered GitHub App client ID:

```sh
VITE_GITHUB_APP_CLIENT_ID=<client-id> pnpm build:chrome
VITE_GITHUB_APP_CLIENT_ID=<client-id> pnpm build:firefox
```

Configure the GitHub App for device authorization and Contents read/write access. Do not put an App private key or client secret in the extension. GitHub App authorization tokens expire; the extension refreshes them when possible and asks you to sign in again if refresh authorization expires.

Firefox asks for optional data permission when GitHub Sync first connects. It covers GitHub authentication details, bookmark data, and saved session URLs; sync stays unavailable if you deny it.

## First sync and conflicts

On the first sync to an existing file, choose whether to merge records by stable ID, replace local data from GitHub (Pull), or replace the GitHub file with this PC (Push). Concurrent edits to the same record require choosing the local or GitHub version. A remote SHA check prevents an upload from silently replacing a file another PC changed during the sync.

The local sync baseline is kept in IndexedDB. Disconnecting removes local GitHub credentials but leaves the remote file and saved repository choice intact.
