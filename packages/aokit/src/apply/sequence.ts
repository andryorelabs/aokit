/** Runs `action` for each item, one at a time, in order. */
export async function inSequence<Item>(
  items: readonly Item[],
  action: (item: Item) => Promise<void>,
): Promise<void> {
  await items.reduce<Promise<void>>(
    (previous, item) => previous.then(() => action(item)),
    Promise.resolve(),
  );
}
