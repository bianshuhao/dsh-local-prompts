import React from 'react'

export const Fragment = React.Fragment

export function jsx(type: any, props: any, key?: any) {
  const { children, ...rest } = props ?? {}
  if (key !== undefined) rest.key = key
  if (children === undefined) return React.createElement(type, rest)
  return React.createElement(type, rest, ...(Array.isArray(children) ? children : [children]))
}

export const jsxs = jsx
