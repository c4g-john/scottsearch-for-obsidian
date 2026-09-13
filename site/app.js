const repository = 'c4g-john/scottsearch-for-obsidian';
const apiBase = `https://api.github.com/repos/${repository}`;

const copyButton = document.querySelector('#copy-repository');
copyButton?.addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(repository);
    copyButton.textContent = 'Copied';
    if (status) status.textContent = 'Repository name copied.';
    window.setTimeout(() => { copyButton.textContent = 'Copy'; }, 1800);
  } catch {
    if (status) status.textContent = `Copy this repository name: ${repository}`;
  }
});

async function enhanceRelease() {
  const status = document.querySelector('#release-live-status');
  try {
    const response = await fetch(`${apiBase}/releases?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const releases = await response.json();
    const release = releases.find((item) => item.tag_name === '0.1.0') ?? releases[0];
    if (!release) return;

    document.querySelectorAll('[data-release-version]').forEach((element) => {
      element.textContent = release.tag_name;
    });
    const zip = release.assets?.find((asset) => asset.name.endsWith('.zip'));
    document.querySelectorAll('[data-release-download]').forEach((element) => {
      element.href = zip?.browser_download_url ?? release.html_url;
    });
    const date = new Date(release.published_at);
    document.querySelectorAll('[data-release-date]').forEach((element) => {
      element.textContent = `Published ${date.toLocaleDateString(undefined, { dateStyle: 'long' })}`;
    });
    if (status) status.textContent = 'Release information is live from GitHub';
  } catch {
    if (status) status.textContent = 'Release information is available from the static site copy';
  }
}

async function enhanceRoadmap() {
  try {
    const response = await fetch(`${apiBase}/issues?state=all&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return;
    const issues = await response.json();
    document.querySelectorAll('[data-issue-state]').forEach((element) => {
      const number = Number(element.dataset.issueState);
      const issue = issues.find((item) => item.number === number && !item.pull_request);
      if (!issue) return;
      element.title = `Live GitHub status: ${issue.state}`;
      if (issue.state === 'closed') {
        element.textContent = 'done';
        element.classList.add('is-done');
      }
    });
  } catch {
    // Static roadmap copy remains complete when GitHub is unavailable.
  }
}

void enhanceRelease();
void enhanceRoadmap();
