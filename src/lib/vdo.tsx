import { createContext, useContext } from 'react';

/** VDO.Ninja view settings for caster feeds (password, extra params, whether to load embeds). */
export const VdoContext = createContext<{ password: string; params: string; embeds: boolean }>({ password: '', params: '&cleanoutput&noaudio&cover', embeds: true });
export const useVdo = () => useContext(VdoContext);
