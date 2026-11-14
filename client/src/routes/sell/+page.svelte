<script lang="ts">
  import { calculateMinIncrement, type Auction, type ListingRules } from '@auction/shared';
  import { onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '#lib/api.ts';
  import { auth } from '#lib/auth.svelte.ts';
  import { clock } from '#lib/clock.svelte.ts';
  import { formatDateTime, formatMoney } from '#lib/format.ts';
  import { loadRules } from '#lib/rules.ts';

  const MINUTE = 60 * 1000;
  const DURATION_PRESETS = [3, 5, 10, 15, 30, 60, 3 * 60, 6 * 60, 12 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60];

  // Creating auctions requires login (RF03)
  $effect(() => {
    if (auth.ready && !auth.user) goto('/login?redirect=/sell', { replace: true });
  });

  // The limits come from the server (RF06), so the form never disagrees with it
  let rules = $state<ListingRules | null>(null);
  let rulesError = $state<string | null>(null);
  loadRules()
    .then((result) => {
      rules = result;
      category = result.categories[0]!;
      durationMinutes = durationOptions(result).includes(24 * 60) ? 24 * 60 : durationOptions(result)[0]!;
    })
    .catch((err) => (rulesError = err.message));

  let title = $state('');
  let category = $state('');
  let description = $state('');
  /** In reais, as typed. */
  let startingPrice = $state<number | null>(null);
  let startMode = $state<'asap' | 'scheduled'>('asap');
  /** `datetime-local` value, in the viewer's timezone. */
  let startLocal = $state('');
  let durationMinutes = $state(24 * 60);
  let error = $state<string | null>(null);
  let submitting = $state(false);

  // --- Photos: kept in order; the first one is the cover
  type Photo = { file: File; preview: string };
  let photos = $state<Photo[]>([]);
  let photoError = $state<string | null>(null);

  function addPhotos(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = ''; // allow picking the same file again after removing it
    if (!rules) return;

    photoError = null;
    for (const file of files) {
      if (photos.length >= rules.photos.max) {
        photoError = `Você pode enviar no máximo ${rules.photos.max} fotos.`;
        break;
      }
      if (!rules.photos.types.includes(file.type)) {
        photoError = `“${file.name}” não é uma imagem JPEG, PNG ou WebP.`;
        continue;
      }
      if (file.size > rules.photos.maxBytes) {
        photoError = `“${file.name}” passa de ${formatMegabytes(rules.photos.maxBytes)}.`;
        continue;
      }
      photos.push({ file, preview: URL.createObjectURL(file) });
    }
  }

  function removePhoto(index: number) {
    URL.revokeObjectURL(photos[index]!.preview);
    photos.splice(index, 1);
  }

  function makeCover(index: number) {
    const [photo] = photos.splice(index, 1);
    photos.unshift(photo!);
  }

  onDestroy(() => photos.forEach((photo) => URL.revokeObjectURL(photo.preview)));

  // --- Start and duration
  function durationOptions(r: ListingRules): number[] {
    const options = DURATION_PRESETS.filter((m) => m >= r.durationMinutes.min && m <= r.durationMinutes.max);
    return options.includes(r.durationMinutes.min) ? options : [r.durationMinutes.min, ...options];
  }

  /** `datetime-local` wants local time without timezone: "2026-11-14T18:05". */
  function toLocalInput(time: number): string {
    const date = new Date(time - new Date(time).getTimezoneOffset() * MINUTE);
    return date.toISOString().slice(0, 16);
  }

  const earliestStart = $derived(rules ? clock.now + rules.leadMinutes.min * MINUTE : clock.now);
  const latestStart = $derived(rules ? clock.now + rules.leadMinutes.max * MINUTE : clock.now);
  /** The start the server will use (approximately, for "as soon as possible"). */
  const startTime = $derived(startMode === 'asap' ? earliestStart : startLocal ? new Date(startLocal).getTime() : NaN);
  const endTime = $derived(startTime + durationMinutes * MINUTE);

  function chooseScheduled() {
    startMode = 'scheduled';
    // Suggest the next full hour that is allowed
    if (!startLocal) startLocal = toLocalInput(Math.ceil((earliestStart + MINUTE) / (60 * MINUTE)) * 60 * MINUTE);
  }

  function formatMegabytes(bytes: number) {
    return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
  }

  function formatDuration(minutes: number) {
    if (minutes % (24 * 60) === 0) return minutes === 24 * 60 ? '1 dia' : `${minutes / (24 * 60)} dias`;
    if (minutes % 60 === 0) return minutes === 60 ? '1 hora' : `${minutes / 60} horas`;
    return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
  }

  const toCents = (reais: number | null) => Math.round((reais ?? 0) * 100);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!rules) return;
    error = null;

    if (photos.length < rules.photos.min) {
      error = `Adicione pelo menos ${rules.photos.min} fotos (você adicionou ${photos.length}).`;
      return;
    }
    if (startMode === 'scheduled' && Number.isNaN(startTime)) {
      error = 'Escolha a data e o horário de início.';
      return;
    }

    const form = new FormData();
    form.append('title', title);
    form.append('category', category);
    form.append('description', description);
    form.append('startingPrice', String(toCents(startingPrice)));
    form.append('durationMinutes', String(durationMinutes));
    // The browser converts the local time to an absolute instant (RF19); the server checks it with its own clock (RF16)
    if (startMode === 'scheduled') form.append('startsAt', new Date(startTime).toISOString());
    for (const photo of photos) form.append('photos', photo.file, photo.file.name);

    submitting = true;
    try {
      const auction = await api.post<Auction>('/auctions', form);
      await goto(`/auctions/${auction.id}`);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Anunciar item · Arremate</title>
</svelte:head>

{#if auth.user}
  <div class="auth-page">
    {#if rulesError}
      <p class="alert alert-error">Não foi possível carregar o formulário: {rulesError}</p>
    {:else if rules}
      <form class="auth-card sell" onsubmit={submit}>
        <div>
          <h1>Anunciar um item</h1>
          <p class="muted">Você não pode dar lances nos próprios itens.</p>
        </div>

        <fieldset>
          <legend>O item</legend>

          <label>
            <span>Nome</span>
            <input
              class="input"
              required
              minlength={rules.titleLength.min}
              maxlength={rules.titleLength.max}
              bind:value={title}
              placeholder="ex.: Fender Stratocaster 1979"
            />
          </label>

          <label>
            <span>Categoria</span>
            <select class="input" bind:value={category}>
              {#each rules.categories as name (name)}
                <option value={name}>{name}</option>
              {/each}
            </select>
          </label>

          <label>
            <span>Descrição</span>
            <textarea
              class="input"
              rows="4"
              required
              minlength={rules.descriptionLength.min}
              maxlength={rules.descriptionLength.max}
              bind:value={description}
              placeholder="Estado de conservação, histórico, o que acompanha…"
            ></textarea>
            <small class="muted counter">{description.length}/{rules.descriptionLength.max}</small>
          </label>

          <div class="photos-field">
            <span class="field-label">Fotos</span>
            <small class="muted">
              De {rules.photos.min} a {rules.photos.max} fotos, JPEG, PNG ou WebP, até {formatMegabytes(rules.photos.maxBytes)} cada.
              A primeira é a capa.
            </small>

            <div class="photos">
              {#each photos as photo, index (photo.preview)}
                <figure>
                  <img src={photo.preview} alt="Foto {index + 1}" />
                  {#if index === 0}
                    <span class="cover-badge">Capa</span>
                  {:else}
                    <button type="button" class="photo-action make-cover" onclick={() => makeCover(index)}>Usar como capa</button>
                  {/if}
                  <button type="button" class="photo-action remove" aria-label="Remover foto {index + 1}" onclick={() => removePhoto(index)}>×</button>
                </figure>
              {/each}

              {#if photos.length < rules.photos.max}
                <label class="add-photo">
                  <input type="file" accept={rules.photos.types.join(',')} multiple onchange={addPhotos} />
                  <span aria-hidden="true">+</span>
                  <small>Adicionar fotos</small>
                </label>
              {/if}
            </div>

            <small class:field-error={photos.length > 0 && photos.length < rules.photos.min} class="muted">
              {photos.length} de {rules.photos.min} fotos obrigatórias{photos.length >= rules.photos.min ? ' ✓' : ''}
            </small>
            {#if photoError}
              <small class="field-error">{photoError}</small>
            {/if}
          </div>
        </fieldset>

        <fieldset>
          <legend>O leilão</legend>

          <div class="row">
            <label>
              <span>Preço inicial (R$)</span>
              <input
                class="input"
                type="number"
                required
                step="0.01"
                min={rules.price.min / 100}
                max={rules.price.max / 100}
                bind:value={startingPrice}
              />
            </label>
            <!-- RF14: the increment comes from a fixed table, by the current price; the seller doesn't choose it -->
            <p class="increment muted">
              {#if startingPrice}
                Os lances sobem de no mínimo <strong>{formatMoney(calculateMinIncrement(toCents(startingPrice)))}</strong> a este preço.
              {/if}
              O incremento é calculado pelo sistema e aumenta conforme o preço sobe.
            </p>
          </div>

          <div class="start" role="radiogroup" aria-label="Início">
            <span class="field-label">Início</span>
            <label class="choice">
              <input type="radio" name="start" value="asap" checked={startMode === 'asap'} onchange={() => (startMode = 'asap')} />
              <span>
                Assim que possível
                <small class="muted">
                  (em {rules.leadMinutes.min === 0 ? 'instantes' : formatDuration(rules.leadMinutes.min)})
                </small>
              </span>
            </label>
            <label class="choice">
              <input type="radio" name="start" value="scheduled" checked={startMode === 'scheduled'} onchange={chooseScheduled} />
              <span>Agendar data e horário</span>
            </label>
            {#if startMode === 'scheduled'}
              <input
                class="input"
                type="datetime-local"
                required
                aria-label="Data e horário de início"
                min={toLocalInput(earliestStart)}
                max={toLocalInput(latestStart)}
                bind:value={startLocal}
              />
            {/if}
          </div>

          <label>
            <span>Duração</span>
            <select class="input" bind:value={durationMinutes}>
              {#each durationOptions(rules) as minutes (minutes)}
                <option value={minutes}>{formatDuration(minutes)}</option>
              {/each}
            </select>
          </label>

          {#if !Number.isNaN(startTime)}
            <p class="summary">
              {startMode === 'asap' ? 'Abre por volta de' : 'Abre em'} <strong>{formatDateTime(new Date(startTime).toISOString())}</strong>
              e termina em <strong>{formatDateTime(new Date(endTime).toISOString())}</strong>
              {#if startingPrice}· lance inicial de <strong>{formatMoney(toCents(startingPrice))}</strong>{/if}
            </p>
          {/if}
        </fieldset>

        {#if error}
          <p class="alert alert-error" role="alert">{error}</p>
        {/if}

        <button class="btn btn-primary" disabled={submitting}>{submitting ? 'Publicando…' : 'Publicar leilão'}</button>
      </form>
    {/if}
  </div>
{/if}

<style>
  .sell {
    max-width: 620px;
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 0;
    padding: 0;
    border: none;
  }

  legend {
    margin-bottom: 12px;
    padding: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  textarea.input {
    height: auto;
    padding: 10px 14px;
    resize: vertical;
  }

  .counter {
    align-self: flex-end;
  }

  .field-label {
    font-size: 14px;
    font-weight: 600;
  }

  .photos-field,
  .start {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .photos-field small,
  .start small {
    font-size: 12px;
  }

  .photos {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
  }

  figure,
  .add-photo {
    position: relative;
    margin: 0;
    aspect-ratio: 1;
    border-radius: 10px;
    overflow: hidden;
  }

  figure img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-badge {
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 2px 8px;
    background: var(--accent);
    color: #fff;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
  }

  .photo-action {
    position: absolute;
    border: none;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    cursor: pointer;
  }

  .make-cover {
    left: 6px;
    bottom: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.15s;
  }

  figure:hover .make-cover,
  .make-cover:focus-visible {
    opacity: 1;
  }

  .remove {
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 16px;
    line-height: 1;
  }

  .add-photo {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 2px dashed var(--border);
    color: var(--muted);
    cursor: pointer;
    font-weight: 400;
    transition: border-color 0.15s, color 0.15s;
  }

  .add-photo:hover,
  .add-photo:focus-within {
    border-color: var(--accent);
    color: var(--accent);
  }

  .add-photo span {
    font-size: 28px;
    line-height: 1;
  }

  .add-photo input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .increment {
    margin: 0;
    align-self: end;
    font-size: 13px;
  }

  .choice {
    flex-direction: row !important;
    align-items: center;
    gap: 8px !important;
    font-weight: 500 !important;
    cursor: pointer;
  }

  .summary {
    padding: 12px 14px;
    background: var(--surface-2);
    border-radius: 10px;
    font-size: 14px;
  }

  @media (max-width: 480px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
