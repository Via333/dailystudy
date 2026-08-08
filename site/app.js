(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector(".theme-toggle");
  const themeKey = "daily-learning-theme-v2";
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem(themeKey);
  } catch {
    // Storage can be disabled; all interactions should still work.
  }

  function setTheme(theme) {
    root.dataset.theme = theme;
    if (themeButton) {
      themeButton.setAttribute("aria-label", theme === "dark" ? "切换浅色模式" : "切换深色模式");
      themeButton.title = theme === "dark" ? "切换浅色模式" : "切换深色模式";
    }
  }

  setTheme(savedTheme || "light");
  themeButton?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(themeKey, next);
    } catch {
      // Keep the in-memory theme even when storage is unavailable.
    }
    setTheme(next);
  });

  const progress = document.querySelector(".reading-progress span");
  function updateProgress() {
    if (!progress) return;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const percentage = scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0;
    progress.style.width = `${percentage}%`;
  }
  updateProgress();
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);

  const copyButton = document.querySelector("[data-copy]");
  copyButton?.addEventListener("click", async () => {
    const original = copyButton.textContent;
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy || "");
      copyButton.textContent = "已复制";
    } catch {
      copyButton.textContent = "复制失败";
    }
    window.setTimeout(() => { copyButton.textContent = original; }, 1800);
  });

  const tocLinks = [...document.querySelectorAll(".lesson-toc a[href^='#']")];
  const sections = [...document.querySelectorAll("[data-lesson-section], #practice")];
  if ("IntersectionObserver" in window && sections.length) {
    const observer = new IntersectionObserver((observed) => {
      const visible = observed.filter((item) => item.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      tocLinks.forEach((link) => link.classList.toggle("is-active", link.hash === `#${visible.target.id}`));
    }, { rootMargin: "-18% 0px -62%", threshold: [0, .15, .5] });
    sections.forEach((section) => observer.observe(section));
  }

  const search = document.querySelector("[data-archive-search]");
  const cards = [...document.querySelectorAll("[data-archive-card]")];
  const empty = document.querySelector("[data-archive-empty]");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase("zh-CN");
    let count = 0;
    cards.forEach((card) => {
      const matches = !query || (card.dataset.search || "").includes(query);
      card.hidden = !matches;
      if (matches) count += 1;
    });
    if (empty) empty.hidden = count > 0;
  });
})();
