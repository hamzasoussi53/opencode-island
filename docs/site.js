// The landing page's own motion: reveal what is on screen, and copy the
// commands. Everything works without this file.

document.documentElement.classList.add("js")

const reveal = () => {
  const items = document.querySelectorAll("[data-reveal]")
  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("in"))
    return
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add("in")
        observer.unobserve(entry.target)
      })
    },
    { rootMargin: "0px 0px -10% 0px" },
  )
  items.forEach((item) => observer.observe(item))
  // Nothing stays hidden if the observer never fires.
  setTimeout(() => items.forEach((item) => item.classList.add("in")), 2500)
}

reveal()

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const code = document.getElementById(button.dataset.copy)
    const label = button.querySelector("span")
    if (!code || !label) return
    try {
      await navigator.clipboard.writeText(code.textContent.trim())
      label.textContent = "Copied"
    } catch {
      label.textContent = "Copy failed"
    }
    setTimeout(() => {
      label.textContent = "Copy"
    }, 1600)
  })
})

// How many stars it has, if the network is there to ask.
fetch("https://api.github.com/repos/hamzasoussi53/opencode-island")
  .then((response) => (response.ok ? response.json() : null))
  .then((repo) => {
    const count = document.querySelector("[data-stars]")
    if (count && repo && repo.stargazers_count) count.textContent = repo.stargazers_count
  })
  .catch(() => {})
