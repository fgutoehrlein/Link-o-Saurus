import type {
  ComponentChildren,
  ComponentType as PreactComponentType,
  FunctionComponent as PreactFunctionComponent,
  JSX as PreactJSX,
  VNode,
} from 'preact';

declare global {
  namespace React {
    type ReactNode = ComponentChildren;
    type ReactElement<P = any, T extends string | React.JSXElementConstructor<any> = string | React.JSXElementConstructor<any>> = VNode<P>;
    type JSXElementConstructor<P> = import('preact').ComponentType<P>;
    type ComponentType<P = {}> = PreactComponentType<P>;
    type FunctionComponent<P = {}> = PreactFunctionComponent<P>;
    type FC<P = {}> = PreactFunctionComponent<P>;
    interface Context<T> extends import('preact').Context<T> {}
  }

  namespace JSX {
    interface Element extends VNode<unknown> {}
    interface IntrinsicElements extends PreactJSX.IntrinsicElements {}
  }
}

declare module 'react' {
  export * from 'preact/compat';
  const React: typeof import('preact/compat');
  export default React;
}

declare module 'react-dom' {
  export * from 'preact/compat';
  const ReactDOM: typeof import('preact/compat');
  export default ReactDOM;
}

declare module 'react/jsx-runtime' {
  export * from 'preact/jsx-runtime';
}
