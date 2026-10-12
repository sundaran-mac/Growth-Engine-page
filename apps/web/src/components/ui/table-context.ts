import * as React from 'react';

/**
 * True inside a container that already pads its content (a non-flush Panel sets this).
 * Then the first and last cells drop their outer padding so text lines up with the panel title.
 * Otherwise the table owns its edge padding (24px, the card padding), so text never touches a border.
 */
export const PaddedContainerContext = React.createContext(false);
