<script lang="ts">
    import { page } from "$app/state";
</script>

<svelte:head>
    <title>Lỗi {page.status}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
    <h1 class="text-2xl font-semibold tracking-tight">
        {page.status === 404 ? "Không tìm thấy" : "Đã xảy ra lỗi"}
    </h1>

    <p class="text-muted-foreground" role="alert">{page.error?.message}</p>

    <p>
        <a href="/" class="underline underline-offset-4">Về trang chủ</a>
    </p>
</main>
