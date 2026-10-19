<script lang="ts">
    import { onMount } from "svelte";
    import { PUBLIC_BACKEND_URL } from "$env/static/public";
    import {
        AlertCircle,
        ArrowDownToLine,
        Check,
        CheckCircle2,
        ChevronDown,
        Clock3,
        FileText,
        Files,
        LayoutDashboard,
        LoaderCircle,
        Plus,
        RefreshCw,
        Search,
        Settings2,
        UploadCloud
    } from "@lucide/svelte";

    type JobStatus = "queued" | "processing" | "completed" | "failed";
    type Job = {
        id: string;
        filename: string;
        fileSize: number;
        status: JobStatus;
        step: string | null;
        progress: number;
        error: string | null;
        createdAt: string;
        updatedAt: string;
        completedAt: string | null;
    };

    const backendUrl = PUBLIC_BACKEND_URL.replace(/\/$/, "");
    let jobs = $state<Job[]>([]);
    let loading = $state(true);
    let uploading = $state(false);
    let errorMessage = $state("");
    let searchTerm = $state("");
    let activeFilter = $state("Tất cả tệp");
    let fileInput: HTMLInputElement;

    const filters = ["Tất cả tệp", "Đang xử lý", "Hoàn tất", "Thất bại"];

    let filteredJobs = $derived(jobs.filter((job) => {
        const matchesSearch = job.filename.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesFilter = activeFilter === "Tất cả tệp"
            || (activeFilter === "Đang xử lý" && (job.status === "queued" || job.status === "processing"))
            || (activeFilter === "Hoàn tất" && job.status === "completed")
            || (activeFilter === "Thất bại" && job.status === "failed");

        return matchesSearch && matchesFilter;
    }));

    let processingCount = $derived(jobs.filter((job) => job.status === "queued" || job.status === "processing").length);
    let completedCount = $derived(jobs.filter((job) => job.status === "completed").length);

    onMount(() => {
        void refreshJobs();
        const refreshTimer = window.setInterval(() => void refreshJobs(), 3000);

        return () => window.clearInterval(refreshTimer);
    });

    async function refreshJobs(): Promise<void> {
        try {
            const response = await fetch(`${backendUrl}/api/jobs`);
            if (!response.ok) {
                throw new Error(`Không thể tải danh sách tệp (HTTP ${response.status})`);
            }

            const payload: unknown = await response.json();
            if (!isJobListResponse(payload)) {
                throw new Error("Máy chủ trả về dữ liệu danh sách không hợp lệ.");
            }

            jobs = payload.jobs;
            errorMessage = "";
        } catch (error: unknown) {
            errorMessage = error instanceof Error ? error.message : "Không thể kết nối máy chủ.";
        } finally {
            loading = false;
        }
    }

    async function uploadFile(file: File | undefined): Promise<void> {
        if (!file) {
            return;
        }

        if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
            errorMessage = "Vui lòng chọn tệp PDF hợp lệ.";
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            errorMessage = "Kích thước tệp tối đa là 50 MB.";
            return;
        }

        uploading = true;
        errorMessage = "";
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(`${backendUrl}/api/uploads`, {
                method: "POST",
                body: formData
            });
            const result: unknown = await response.json();
            if (!response.ok) {
                throw new Error(getResponseMessage(result) ?? "Tải tệp lên thất bại.");
            }

            await refreshJobs();
        } catch (error: unknown) {
            errorMessage = error instanceof Error ? error.message : "Tải tệp lên thất bại.";
        } finally {
            uploading = false;
            fileInput.value = "";
        }
    }

    function isJobListResponse(value: unknown): value is { jobs: Job[] } {
        if (typeof value !== "object" || value === null || !("jobs" in value)) {
            return false;
        }

        return Array.isArray(value.jobs) && value.jobs.every((job: unknown) => {
            if (typeof job !== "object" || job === null) {
                return false;
            }

            return "id" in job
                && typeof job.id === "string"
                && "filename" in job
                && typeof job.filename === "string"
                && "fileSize" in job
                && typeof job.fileSize === "number"
                && Number.isFinite(job.fileSize)
                && "status" in job
                && (job.status === "queued" || job.status === "processing" || job.status === "completed" || job.status === "failed")
                && "step" in job
                && (typeof job.step === "string" || job.step === null)
                && "progress" in job
                && typeof job.progress === "number"
                && Number.isFinite(job.progress)
                && "error" in job
                && (typeof job.error === "string" || job.error === null)
                && "createdAt" in job
                && typeof job.createdAt === "string"
                && "updatedAt" in job
                && typeof job.updatedAt === "string"
                && "completedAt" in job
                && (typeof job.completedAt === "string" || job.completedAt === null);
        });
    }

    function getResponseMessage(value: unknown): string | null {
        if (typeof value === "object" && value !== null && "message" in value && typeof value.message === "string") {
            return value.message;
        }

        return null;
    }

    function formatSize(bytes: number): string {
        if (bytes < 1024 * 1024) {
            return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        }

        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function formatDate(dateValue: string): string {
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) {
            return "Vừa xong";
        }

        return new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    }

    function statusLabel(status: JobStatus): string {
        if (status === "queued" || status === "processing") {
            return "Đang xử lý";
        }

        return status === "completed" ? "Hoàn tất" : "Thất bại";
    }
</script>

<svelte:head>
    <title>Kho PDF Luật Giao thông</title>
    <meta name="description" content="Bảng điều khiển quản lý và xử lý tài liệu PDF." />
</svelte:head>

<div class="admin-shell">
    <aside class="sidebar">
        <a class="brand" href="/" aria-label="Kho PDF Luật Giao thông - trang chủ">
            <span class="brand-mark"><FileText size={21} strokeWidth={2.2} /></span>
            <span>Kho PDF Luật Giao thông<span class="brand-dot">.</span></span>
        </a>

        <div class="workspace-label">WORKSPACE</div>
        <button class="workspace-switch" type="button">
            <span class="workspace-avatar">D</span>
            <span class="workspace-copy"><strong>Document Hub</strong><small>Không gian làm việc</small></span>
            <ChevronDown size={16} />
        </button>

        <nav class="side-nav" aria-label="Điều hướng chính">
            <div class="nav-caption">TỔNG QUAN</div>
            <a class="nav-link" href="/"><LayoutDashboard size={18} /><span>Tổng quan</span></a>
            <a class="nav-link active" href="/" aria-current="page"><Files size={18} /><span>Tài liệu</span><span class="nav-count">{jobs.length}</span></a>
            <a class="nav-link" href="#activity"><Clock3 size={18} /><span>Lịch sử xử lý</span></a>
        </nav>

        <div class="sidebar-bottom">
            <div class="storage-card">
                <div class="storage-heading"><span>Dung lượng lưu trữ</span><span>68%</span></div>
                <div class="storage-track"><span></span></div>
                <small>6.8 GB trong 10 GB</small>
            </div>
            <button class="nav-link settings-link" type="button"><Settings2 size={18} /><span>Cài đặt</span></button>
            <div class="profile-row">
                <div class="profile-avatar">AN</div>
                <div class="profile-copy"><strong>Admin Nguyễn</strong><small>Quản trị viên</small></div>
                <ChevronDown size={16} />
            </div>
        </div>
    </aside>

    <main class="main-content">
        <header class="topbar">
            <div class="breadcrumb">Workspace <span>/</span> <strong>Tài liệu</strong></div>
            <div class="topbar-right"><span class="system-status"><span></span> Hệ thống hoạt động</span><div class="topbar-avatar">AN</div></div>
        </header>

        <div class="page-content">
            <div class="page-heading">
                <div>
                    <div class="eyebrow">KHÔNG GIAN LÀM VIỆC</div>
                    <h1>Quản lý tài liệu</h1>
                    <p>Tải lên và theo dõi trạng thái xử lý các tài liệu PDF của bạn.</p>
                </div>
                <button class="primary-button" type="button" onclick={() => fileInput.click()} disabled={uploading}>
                    {#if uploading}<LoaderCircle size={17} class="spin" />{:else}<Plus size={18} />{/if}
                    {uploading ? "Đang tải lên..." : "Tải lên tài liệu"}
                </button>
            </div>

            {#if errorMessage}
                <div class="alert" role="alert"><AlertCircle size={18} /><span>{errorMessage}</span><button type="button" onclick={() => errorMessage = ""} aria-label="Đóng thông báo">×</button></div>
            {/if}

            <section class="stats-grid" aria-label="Thống kê tài liệu">
                <article class="stat-card"><div class="stat-icon lavender"><Files size={19} /></div><div class="stat-label">Tổng tài liệu</div><div class="stat-value">{jobs.length}<span>tệp</span></div><div class="stat-foot">Trong 100 tệp gần nhất</div></article>
                <article class="stat-card"><div class="stat-icon amber"><LoaderCircle size={19} /></div><div class="stat-label">Đang xử lý</div><div class="stat-value">{processingCount}<span>tệp</span></div><div class="stat-foot">Đang chạy trong hàng đợi</div></article>
                <article class="stat-card"><div class="stat-icon green"><CheckCircle2 size={19} /></div><div class="stat-label">Đã hoàn tất</div><div class="stat-value">{completedCount}<span>tệp</span></div><div class="stat-foot">Xử lý thành công</div></article>
                <article class="stat-card"><div class="stat-icon blue"><ArrowDownToLine size={19} /></div><div class="stat-label">Dung lượng đã dùng</div><div class="stat-value">6.8<span>GB</span></div><div class="stat-foot">Trên tổng dung lượng 10 GB</div></article>
            </section>

            <section class="upload-card" aria-label="Tải tài liệu PDF">
                <input bind:this={fileInput} class="visually-hidden" type="file" accept="application/pdf,.pdf" onchange={(event) => uploadFile(event.currentTarget.files?.[0])} />
                <div class="upload-icon"><UploadCloud size={25} /></div>
                <div class="upload-copy"><h2>Tải lên tài liệu mới</h2><p>Kéo thả tệp PDF vào đây hoặc chọn từ thiết bị của bạn.</p><span>PDF · Tối đa 50 MB mỗi tệp</span></div>
                <button class="outline-button" type="button" onclick={() => fileInput.click()} disabled={uploading}>{uploading ? "Đang tải lên..." : "Chọn tệp PDF"}</button>
            </section>

            <section class="documents-card" id="activity">
                <div class="table-heading"><div><h2>Tài liệu gần đây</h2><p>Theo dõi các tệp đã tải lên và tiến độ xử lý.</p></div><button class="icon-button" type="button" aria-label="Làm mới danh sách" onclick={() => refreshJobs()}><RefreshCw size={17} /></button></div>
                <div class="table-toolbar">
                    <div class="filter-tabs" aria-label="Lọc tài liệu">{#each filters as filter}<button type="button" class:chosen={activeFilter === filter} onclick={() => activeFilter = filter}>{filter}{#if filter === "Đang xử lý" && processingCount > 0}<span>{processingCount}</span>{/if}</button>{/each}</div>
                    <label class="search-box"><Search size={16} /><input bind:value={searchTerm} placeholder="Tìm tài liệu..." aria-label="Tìm tài liệu" /></label>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead><tr><th>TÊN TÀI LIỆU</th><th>NGÀY TẢI LÊN</th><th>DUNG LƯỢNG</th><th>TRẠNG THÁI</th><th></th></tr></thead>
                        <tbody>
                            {#if loading}
                                <tr><td colspan="5" class="empty-state">Đang tải danh sách tài liệu...</td></tr>
                            {:else if filteredJobs.length === 0}
                                <tr><td colspan="5" class="empty-state"><span class="empty-icon"><FileText size={22} /></span><strong>Chưa có tài liệu nào</strong><span>Tải lên tệp PDF đầu tiên để bắt đầu.</span></td></tr>
                            {:else}
                                {#each filteredJobs as job (job.id)}
                                    <tr>
                                        <td><div class="file-cell"><div class="pdf-icon"><FileText size={18} /></div><div class="file-name"><strong>{job.filename}</strong><small>PDF document · {job.id.slice(0, 8)}</small></div></div></td>
                                        <td class="date-cell">{formatDate(job.createdAt)}</td>
                                        <td class="size-cell">{formatSize(job.fileSize)}</td>
                                        <td><div class="status-cell"><span class:working={job.status === "queued" || job.status === "processing"} class:success={job.status === "completed"} class:failed={job.status === "failed"} class="status-badge">{#if job.status === "completed"}<Check size={13} />{:else if job.status === "failed"}<AlertCircle size={13} />{:else}<LoaderCircle size={13} class="spin" />{/if}{statusLabel(job.status)}</span>{#if job.status === "queued" || job.status === "processing"}<div class="progress-row"><div class="progress-track"><span style={`width: ${Math.max(5, job.progress)}%`}></span></div><small>{job.progress}%</small></div>{:else if job.status === "failed" && job.error}<small class="error-detail">{job.error}</small>{/if}</div></td>
                                        <td><button class="row-menu" type="button" aria-label={`Tùy chọn ${job.filename}`}>···</button></td>
                                    </tr>
                                {/each}
                            {/if}
                        </tbody>
                    </table>
                </div>
                <footer class="table-footer"><span>Hiển thị <strong>{filteredJobs.length}</strong> trên <strong>{jobs.length}</strong> tài liệu gần đây</span><span class="live-refresh"><span></span> Tự động cập nhật</span></footer>
            </section>
            <footer class="page-footer">© 2025 Kho PDF Luật Giao thông <span>·</span> Quản lý tài liệu an toàn, đơn giản.</footer>
        </div>
    </main>
</div>

<style>
    :global(body) { margin: 0; background: #f7f8fc; color: #202137; font-family: 'Inter Variable', sans-serif; }
    :global(*) { box-sizing: border-box; }
    .admin-shell { min-height: 100vh; display: flex; }
    .sidebar { width: 252px; flex: 0 0 252px; position: fixed; inset: 0 auto 0 0; display: flex; flex-direction: column; padding: 25px 17px 16px; background: #fff; border-right: 1px solid #ececf3; z-index: 2; }
    .brand { display: flex; align-items: center; gap: 10px; padding: 0 7px; color: #24233e; font-size: 21px; font-weight: 750; letter-spacing: -.8px; text-decoration: none; }
    .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; color: #fff; background: linear-gradient(145deg, #7868ee, #5949d6); }
    .brand-dot { color: #7868ee; }
    .workspace-label, .nav-caption { color: #9a9bae; font-size: 10px; font-weight: 750; letter-spacing: 1.15px; }
    .workspace-label { margin: 38px 8px 12px; }
    .workspace-switch { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid #ededf3; border-radius: 10px; background: #fff; color: #77798c; text-align: left; cursor: pointer; }
    .workspace-avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: #f0edff; color: #6859dc; font-weight: 750; }
    .workspace-copy, .profile-copy { display: grid; flex: 1; gap: 3px; }
    .workspace-copy strong, .profile-copy strong { color: #33344b; font-size: 12px; font-weight: 650; }
    .workspace-copy small, .profile-copy small { color: #999aab; font-size: 10px; }
    .side-nav { margin-top: 32px; }
    .nav-caption { margin: 0 9px 11px; }
    .nav-link { display: flex; align-items: center; gap: 12px; padding: 10px; margin: 3px 0; border-radius: 8px; color: #74768a; font-size: 12px; text-decoration: none; }
    .nav-link.active { background: #f1efff; color: #6658dc; font-weight: 650; }
    .nav-count { margin-left: auto; min-width: 22px; padding: 3px 6px; border-radius: 10px; background: #e5e1ff; color: #6557d9; text-align: center; font-size: 10px; }
    .sidebar-bottom { margin-top: auto; }
    .storage-card { padding: 14px 12px; margin-bottom: 20px; border: 1px solid #eeeef4; border-radius: 10px; }
    .storage-heading { display: flex; justify-content: space-between; color: #5d5f73; font-size: 10px; font-weight: 600; }
    .storage-heading span:last-child { color: #7770d9; }
    .storage-track, .progress-track { overflow: hidden; background: #eeedf5; border-radius: 10px; }
    .storage-track { height: 5px; margin: 11px 0 8px; }
    .storage-track span { display: block; width: 68%; height: 100%; border-radius: inherit; background: #7869e9; }
    .storage-card small { color: #9a9bad; font-size: 10px; }
    .settings-link { width: 100%; padding-left: 8px; border: 0; background: transparent; cursor: pointer; }
    .profile-row { display: flex; align-items: center; gap: 10px; padding: 16px 4px 3px; margin-top: 13px; border-top: 1px solid #f0f0f5; color: #9a9bad; }
    .profile-avatar, .topbar-avatar { display: grid; place-items: center; border-radius: 50%; background: #e8e5ff; color: #6658d9; font-size: 10px; font-weight: 700; }
    .profile-avatar { width: 34px; height: 34px; }
    .main-content { min-width: 0; flex: 1; margin-left: 252px; }
    .topbar { height: 67px; display: flex; align-items: center; justify-content: space-between; padding: 0 42px; border-bottom: 1px solid #ececf3; background: #fff; }
    .breadcrumb { color: #9293a5; font-size: 11px; }
    .breadcrumb span { padding: 0 9px; color: #c4c4cf; }
    .breadcrumb strong { color: #414258; font-weight: 600; }
    .topbar-right { display: flex; align-items: center; gap: 20px; }
    .system-status, .live-refresh { display: flex; align-items: center; gap: 7px; color: #77798d; font-size: 10px; }
    .system-status span, .live-refresh span { width: 7px; height: 7px; border-radius: 50%; background: #2ac28b; box-shadow: 0 0 0 3px #e6f8f1; }
    .topbar-avatar { width: 30px; height: 30px; }
    .page-content { width: min(1240px, 100%); padding: 37px 42px 22px; margin: 0 auto; }
    .page-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 26px; }
    .eyebrow { margin-bottom: 8px; color: #898a9d; font-size: 9px; font-weight: 700; letter-spacing: 1.2px; }
    h1 { margin: 0; color: #25263c; font-size: 25px; font-weight: 690; letter-spacing: -.7px; }
    .page-heading p { margin: 8px 0 0; color: #8a8b9d; font-size: 12px; }
    .primary-button, .outline-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 8px; font: inherit; font-size: 11px; font-weight: 620; cursor: pointer; transition: .15s ease; }
    .primary-button { padding: 11px 15px; border: 1px solid #6557db; background: #6b5de0; color: white; box-shadow: 0 3px 8px #6b5de022; }
    .primary-button:hover { background: #5c4ed2; }
    button:disabled { opacity: .62; cursor: wait; }
    .alert { display: flex; align-items: center; gap: 9px; padding: 11px 13px; margin: -8px 0 18px; border: 1px solid #f5caca; border-radius: 8px; background: #fff4f3; color: #a84545; font-size: 11px; }
    .alert button { margin-left: auto; border: 0; background: transparent; color: inherit; font-size: 19px; cursor: pointer; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 19px; }
    .stat-card { padding: 16px 17px 14px; border: 1px solid #ebebf2; border-radius: 10px; background: #fff; box-shadow: 0 2px 5px #29284b05; }
    .stat-icon { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: 13px; border-radius: 9px; }
    .lavender { background: #f0edff; color: #7364e5; }.amber { background: #fff4df; color: #e4a52e; }.green { background: #e6f8f1; color: #23ab78; }.blue { background: #e9f3ff; color: #5198df; }
    .stat-label { color: #858699; font-size: 10px; }
    .stat-value { margin-top: 5px; color: #303147; font-size: 23px; font-weight: 700; letter-spacing: -.5px; }
    .stat-value span { margin-left: 5px; color: #9b9cad; font-size: 10px; font-weight: 500; letter-spacing: 0; }
    .stat-foot { margin-top: 8px; color: #a0a1b0; font-size: 9px; }
    .upload-card { display: flex; align-items: center; gap: 15px; padding: 15px 18px; margin-bottom: 19px; border: 1px dashed #d8d5f4; border-radius: 10px; background: linear-gradient(100deg, #faf9ff, #fff); }
    .upload-icon { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 10px; background: #eeebff; color: #6c5ddd; }
    .upload-copy { flex: 1; }
    .upload-copy h2, .table-heading h2 { margin: 0; color: #33344a; font-size: 12px; font-weight: 650; }
    .upload-copy p { margin: 5px 0; color: #858699; font-size: 10px; }
    .upload-copy > span { color: #aaaaba; font-size: 9px; }
    .outline-button { padding: 9px 12px; border: 1px solid #e0dff0; background: #fff; color: #5f5c8a; }
    .outline-button:hover { border-color: #bbb4f0; background: #faf9ff; }
    .documents-card { overflow: hidden; border: 1px solid #eaeaf1; border-radius: 10px; background: #fff; box-shadow: 0 2px 6px #29284b05; }
    .table-heading { display: flex; align-items: center; justify-content: space-between; padding: 18px 19px 15px; }
    .table-heading h2 { font-size: 13px; }
    .table-heading p { margin: 5px 0 0; color: #9697a8; font-size: 10px; }
    .icon-button, .row-menu { display: grid; place-items: center; width: 31px; height: 31px; border: 1px solid #ececf2; border-radius: 7px; background: #fff; color: #818295; cursor: pointer; }
    .icon-button:hover { background: #f7f6ff; color: #6658d9; }
    .table-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 0 19px 12px; }
    .filter-tabs { display: flex; align-items: center; gap: 5px; }
    .filter-tabs button { display: flex; align-items: center; gap: 6px; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; color: #8d8ea0; font: inherit; font-size: 10px; cursor: pointer; }
    .filter-tabs button.chosen { background: #f0effb; color: #6458d2; font-weight: 650; }
    .filter-tabs button span { padding: 2px 5px; border-radius: 8px; background: #fff; font-size: 9px; }
    .search-box { display: flex; align-items: center; gap: 7px; width: 184px; padding: 7px 9px; border: 1px solid #ececf2; border-radius: 7px; color: #a1a2b1; }
    .search-box input { width: 100%; border: 0; outline: none; color: #46475c; font: inherit; font-size: 10px; background: transparent; }
    .search-box input::placeholder { color: #aaaaba; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    thead { background: #fafafd; }
    th { padding: 10px 14px; color: #9a9bac; font-size: 8px; font-weight: 700; letter-spacing: .65px; white-space: nowrap; }
    th:first-child, td:first-child { padding-left: 19px; }
    th:last-child, td:last-child { padding-right: 17px; text-align: right; }
    td { padding: 12px 14px; border-top: 1px solid #f0f0f5; color: #77798d; font-size: 10px; }
    .file-cell { display: flex; align-items: center; gap: 10px; min-width: 215px; }
    .pdf-icon { display: grid; place-items: center; width: 34px; height: 36px; border: 1px solid #f1dada; border-radius: 7px; background: #fff5f4; color: #d56b65; }
    .file-name { display: grid; gap: 4px; }
    .file-name strong { max-width: 250px; overflow: hidden; color: #46475c; font-size: 10px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
    .file-name small { color: #a1a2b0; font-size: 9px; }
    .date-cell, .size-cell { white-space: nowrap; }
    .status-cell { display: grid; gap: 6px; width: 110px; }
    .status-badge { display: inline-flex; align-items: center; gap: 5px; width: fit-content; padding: 4px 7px; border-radius: 12px; font-size: 9px; white-space: nowrap; }
    .status-badge.working { background: #fff6e6; color: #bf8525; }.status-badge.success { background: #e8f8f0; color: #24885f; }.status-badge.failed { background: #fff0ef; color: #c2534d; }
    .progress-row { display: flex; align-items: center; gap: 6px; }
    .progress-track { flex: 1; height: 4px; }.progress-track span { display: block; height: 100%; border-radius: inherit; background: #e7ae45; transition: width .3s; }
    .progress-row small { width: 25px; color: #a3a3af; font-size: 8px; }
    .error-detail { max-width: 190px; overflow: hidden; color: #c2534d; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
    .row-menu { width: 28px; height: 28px; border-color: transparent; font-size: 19px; letter-spacing: 1px; }
    .row-menu:hover { border-color: #ececf2; }
    .empty-state { height: 160px; color: #9293a5; text-align: center; }
    .empty-state strong, .empty-state span { display: block; }
    .empty-state strong { margin: 7px 0 4px; color: #55566c; font-size: 11px; }
    .empty-state > span:last-child { font-size: 10px; }
    .empty-icon { display: inline-grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: #f3f2fb; color: #8175dc; }
    .table-footer { display: flex; align-items: center; justify-content: space-between; padding: 12px 19px; border-top: 1px solid #f0f0f5; color: #9a9bac; font-size: 9px; }
    .table-footer strong { color: #68697e; font-weight: 650; }
    .page-footer { padding: 20px 0 4px; color: #a4a5b3; font-size: 9px; text-align: center; }
    .page-footer span { padding: 0 4px; color: #c3c3ce; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    :global(.spin) { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 1100px) { .sidebar { width: 220px; flex-basis: 220px; }.main-content { margin-left: 220px; }.page-content { padding-right: 25px; padding-left: 25px; }.topbar { padding: 0 25px; }.stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 720px) { .sidebar { width: 62px; flex-basis: 62px; align-items: center; padding: 18px 7px; }.brand { padding: 0; }.brand > span:last-child, .workspace-label, .workspace-switch, .nav-caption, .nav-link span, .storage-card, .profile-copy { display: none; }:global(.profile-row > svg) { display: none; }.side-nav { width: 100%; margin-top: 38px; }.nav-link { justify-content: center; padding: 12px 0; }.nav-link.active { background: #f1efff; }.profile-row { justify-content: center; width: 100%; padding: 15px 0 0; }.main-content { margin-left: 62px; }.topbar { height: 56px; padding: 0 16px; }.system-status { font-size: 0; }.page-content { padding: 26px 14px 18px; }.page-heading { align-items: flex-start; gap: 12px; }.page-heading h1 { font-size: 21px; }.page-heading p { max-width: 250px; line-height: 1.5; }.primary-button { flex: 0 0 auto; padding: 10px; font-size: 0; }.primary-button :global(svg) { width: 19px; height: 19px; }.stats-grid { gap: 9px; }.stat-card { padding: 13px; }.upload-card { align-items: flex-start; flex-wrap: wrap; padding: 13px; }.upload-copy { min-width: 160px; }.upload-copy p { line-height: 1.5; }.outline-button { margin-left: 57px; }.table-heading { padding-right: 13px; padding-left: 13px; }.table-toolbar { align-items: flex-start; flex-direction: column-reverse; gap: 9px; padding: 0 13px 11px; }.search-box { width: 100%; }.filter-tabs { width: 100%; justify-content: space-between; gap: 0; }.filter-tabs button { padding: 7px 5px; font-size: 9px; }.table-footer { padding: 11px 13px; }.live-refresh { font-size: 0; } }
</style>
