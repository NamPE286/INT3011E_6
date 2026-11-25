<script lang="ts">
    import { goto } from "$app/navigation";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { sessionStore } from "$lib/stores/session.svelte";
    import { Lock, Mail, Scale, User } from "@lucide/svelte";

    let mode = $state<"signin" | "signup">("signin");
    let name = $state("");
    let email = $state("");
    let password = $state("");
    let errorMessage = $state<string | null>(null);
    let submitting = $state(false);

    async function handleSubmit(event: SubmitEvent): Promise<void> {
        event.preventDefault();
        errorMessage = null;
        submitting = true;

        try {
            const result =
                mode === "signin"
                    ? await sessionStore.signIn(email, password)
                    : await sessionStore.signUp(name || email.split("@")[0] || "Nhà soạn luật", email, password);

            if (!result.ok) {
                errorMessage = result.message;

                return;
            }

            await goto("/");
        } finally {
            submitting = false;
        }
    }
</script>

<svelte:head>
    <title>{mode === "signin" ? "Đăng nhập" : "Đăng ký"} — Soạn Luật Studio</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-12 sm:py-16">
    <div class="flex flex-col items-center gap-3 text-center">
        <span class="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Scale class="size-6" aria-hidden="true" />
        </span>
        <h1 class="text-2xl font-semibold tracking-tight">Soạn Luật Studio</h1>
        <p class="text-sm text-muted-foreground">
            Đăng nhập bằng email & mật khẩu (Better Auth) để quản lý nhiều không gian soạn thảo pháp luật độc lập.
        </p>
    </div>

    <div class="rounded-2xl border bg-card p-6 shadow-sm">
        <div class="mb-6 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm font-medium">
            <button
                type="button"
                onclick={() => {
                    mode = "signin";
                    errorMessage = null;
                }}
                class={`rounded-md py-2 transition-colors ${mode === "signin" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
            >
                Đăng nhập
            </button>
            <button
                type="button"
                onclick={() => {
                    mode = "signup";
                    errorMessage = null;
                }}
                class={`rounded-md py-2 transition-colors ${mode === "signup" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
            >
                Tạo tài khoản
            </button>
        </div>

        <form class="flex flex-col gap-4" onsubmit={handleSubmit}>
            {#if mode === "signup"}
                <label class="flex flex-col gap-1.5 text-sm">
                    <span class="font-medium">Họ và tên / Chức danh</span>
                    <div class="relative">
                        <User class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            type="text"
                            bind:value={name}
                            required
                            placeholder="VD: Chuyên viên Nguyễn Văn An"
                            class="pl-9"
                        />
                    </div>
                </label>
            {/if}

            <label class="flex flex-col gap-1.5 text-sm">
                <span class="font-medium">Email</span>
                <div class="relative">
                    <Mail class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                        type="email"
                        bind:value={email}
                        required
                        autocomplete="email"
                        placeholder="soanluat@chinhphu.vn"
                        class="pl-9"
                    />
                </div>
            </label>

            <label class="flex flex-col gap-1.5 text-sm">
                <span class="font-medium">Mật khẩu</span>
                <div class="relative">
                    <Lock class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                        type="password"
                        bind:value={password}
                        required
                        minlength={6}
                        autocomplete={mode === "signin" ? "current-password" : "new-password"}
                        placeholder="Tối thiểu 6 ký tự"
                        class="pl-9"
                    />
                </div>
            </label>

            {#if errorMessage}
                <p class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                    {errorMessage}
                </p>
            {/if}

            <Button type="submit" disabled={submitting} class="mt-1 w-full">
                {#if submitting}
                    Đang xử lý…
                {:else if mode === "signin"}
                    Đăng nhập vào không gian làm việc
                {:else}
                    Đăng ký & khởi tạo Workspace mặc định
                {/if}
            </Button>
        </form>
    </div>

    <p class="text-center text-xs text-muted-foreground">
        Mỗi tài khoản có thể tạo nhiều Workspace riêng biệt — mỗi Workspace lưu trữ bộ văn bản, điều khoản và lược đồ quan hệ độc lập.
    </p>
</main>
