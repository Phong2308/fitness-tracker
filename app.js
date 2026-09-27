// Entry point. Feature code is loaded in order by index.html (defer scripts).
async function initializeApp() {
    if (!WEB_APP_URL || !WEB_APP_URL.startsWith("https://script.google.com/macros/s/") || !WEB_APP_URL.endsWith("/exec")) {
        throw new Error("Kiểm tra WEB_APP_URL trong src/config.js.");
    }
    await showUserSelector();
}

document.addEventListener("DOMContentLoaded", async () => {
    try {
        await initializeApp();
    } catch (error) {
        console.error("Không khởi động được Fitness Tracker:", error);
        const app = document.getElementById("app");
        app.innerHTML = `<section class="card"><h2>Không tải được ứng dụng</h2><p>${htmlText(error.message)}</p><button id="retryApp">Thử lại</button></section>`;
        document.getElementById("retryApp").onclick = () => location.reload();
    } finally {
        window.dispatchEvent(new Event("fitnessAppReady"));
    }
});
