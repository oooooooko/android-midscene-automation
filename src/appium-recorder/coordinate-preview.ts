import { computed, provide, shallowRef, watch, type InjectionKey, type Ref } from 'vue';

type Point = { x: number; y: number };
interface CoordinatePicker {
  enabled: Readonly<Ref<boolean>>;
  owner: Readonly<Ref<symbol | undefined>>;
  start: (owner: symbol, select: (point: Point) => void) => void;
  cancel: (owner?: symbol) => void;
}
export const coordinatePreviewKey: InjectionKey<CoordinatePicker> = Symbol('coordinate-preview');

export function useCoordinatePicker(enabled: Readonly<Ref<boolean>>, showPreview: () => void) {
  const session = shallowRef<{ owner: symbol; select: (point: Point) => void }>();
  function cancel(owner?: symbol) {
    if (!owner || session.value?.owner === owner) session.value = undefined;
  }
  provide(coordinatePreviewKey, {
    enabled,
    owner: computed(() => session.value?.owner),
    start(owner, select) {
      if (!enabled.value) return;
      session.value = { owner, select };
      showPreview();
    },
    cancel,
  });
  watch(enabled, (value) => { if (!value) cancel(); });
  return {
    picking: computed(() => Boolean(session.value)),
    cancel,
    select(point: Point) {
      const current = session.value;
      cancel();
      if (enabled.value) current?.select(point);
    },
  };
}
