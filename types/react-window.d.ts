import type { ComponentChildren } from 'preact';
import type { ComponentType } from 'react';
import type { ListChildComponentProps } from 'react-window';

declare module 'react-window' {
  interface FixedSizeListProps<T> {
    children: ((props: ListChildComponentProps<T>) => ComponentChildren) | ComponentType<ListChildComponentProps<T>>;
  }
}
