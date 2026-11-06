/* Screenshot the MCP Station panel from the isolated E2E web app. */
const { chromium } = require('/Users/wilson/.dsh/workspace/pw/bundle/node_modules/playwright')

async function dismissFirstRun(page) {
  const labels = ["继续", "知道了", "我知道了", "开始使用"]
  for (let round = 0; round < 6; round += 1) {
    const mask = page.locator("[class*=_mask_]").first()
    const hasMask = (await mask.count()) > 0 && (await mask.isVisible().catch(() => false))
    if (!hasMask) return true
    await page.waitForTimeout(900)
    let clicked = false
    for (const label of labels) {
      const button = page.getByRole("button", { name: label, exact: true }).first()
      try {
        if (await button.isVisible({ timeout: 500 })) {
          await button.click({ timeout: 5000 })
          clicked = true
          console.log("dismissed first-run:", label, "round", round)
          break
        }
      } catch {
        /* try next */
      }
    }
    if (!clicked) await page.keyboard.press("Escape")
    await page.waitForTimeout(700)
  }
  return (await page.locator("[class*=_mask_]").count()) === 0
}

async function main() {
  const url = process.argv[2]
  const outDir = process.argv[3]
  const browser = await chromium.launch({ headless: true, channel: "chrome" })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: outDir + "/00-shell.png", fullPage: false })
  const dismissed = await dismissFirstRun(page)
  console.log("first-run overlay dismissed:", dismissed)
  await page.screenshot({ path: outDir + "/01-home.png", fullPage: false })

  const button = page.locator("button.ms_footBtn").first()
  console.log("sidebar MCP Station buttons:", await button.count())
  await button.click({ timeout: 15000 })
  await page.waitForTimeout(1500)
  const panel = page.locator(".ms_panel").first()
  console.log("panel visible:", await panel.isVisible())
  await page.screenshot({ path: outDir + "/02-panel-store.png", fullPage: false })
  console.log("panel text:", (await panel.innerText()).slice(0, 500).replace(/\s+/g, " "))

  const tabs = [["应用商店", "store"], ["已安装", "installed"], ["设置", "settings"]]
  for (const [tab, slug] of tabs) {
    const tabButton = panel.getByRole("tab", { name: tab }).first()
    if (await tabButton.count()) {
      await tabButton.click({ timeout: 5000 })
      await page.waitForTimeout(900)
      await page.screenshot({ path: outDir + "/03-tab-" + slug + ".png", fullPage: false })
      console.log("tab shot:", slug)
    }
  }
  console.log("page errors:", errors.length ? errors.slice(0, 8) : "none")
  await browser.close()
}

main().catch((error) => { console.error("FAILED:", error && error.message ? error.message : error); process.exit(1) })
