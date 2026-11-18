import { useState } from 'react';
import type { FormEvent } from 'react';
import { Delete, Globe, LogIn } from 'lucide-react';
import { localeOptions, localeText, type LocaleCode } from './locales';

export interface LoginUser {
  id: string;
  role: 'jeweller' | 'karigar' | 'staff';
  name: string;
}

interface Props {
  language: LocaleCode;
  onLanguageChange: (language: LocaleCode) => void;
  onLogin: (user: LoginUser) => void;
}

const keypad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

export default function PinLogin({ language, onLanguageChange, onLogin }: Props) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const text = localeText[language].app;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || pin.length < 4 || !phone.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), pin }),
      });
      const data = await response.json() as Partial<LoginUser> & { error?: string };
      if (!response.ok) throw new Error(data.error ?? text.pinError);
      if (!data.id || !data.name
        || (data.role !== 'jeweller' && data.role !== 'karigar' && data.role !== 'staff')) {
        throw new Error(text.pinError);
      }
      onLogin({ id: data.id, name: data.name, role: data.role });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : text.pinError);
    } finally {
      setBusy(false);
    }
  };

  const pressKey = (key: string) => {
    setError('');
    if (key === 'clear') {
      setPin('');
    } else if (key === 'back') {
      setPin((current) => current.slice(0, -1));
    } else {
      setPin((current) => current.length < 6 ? `${current}${key}` : current);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-stone-50 p-5 text-gray-950">
      <div className="mb-6 flex justify-end">
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-3">
          <Globe aria-hidden="true" size={20} />
          <span className="sr-only">{text.login}</span>
          <select
            aria-label={text.login}
            className="min-h-11 bg-transparent font-bold outline-none"
            value={language}
            onChange={(event) => onLanguageChange(event.target.value as LocaleCode)}
          >
            {localeOptions.map((option) => (
              <option key={option.code} value={option.code}>{option.name}</option>
            ))}
          </select>
        </label>
      </div>
      <h1 className="mb-2 text-center text-3xl font-black text-amber-700">{text.login}</h1>
      <p className="mb-7 text-center text-sm font-medium text-gray-700">{text.pinHelp}</p>
      <form onSubmit={submit} className="space-y-5">
        <label className="block text-lg font-bold">
          {text.phone}
          <input
            autoComplete="tel"
            inputMode="tel"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="mt-2 min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 text-xl"
          />
        </label>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-lg font-bold">{text.pin}</span>
            <span aria-label={`${pin.length} digits entered`} className="min-w-24 text-right text-xl tracking-[0.3em]">
              {pin ? '●'.repeat(pin.length) : '— — — —'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {keypad.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => pressKey(key)}
                aria-label={key === 'back' ? 'Delete last digit' : key === 'clear' ? 'Clear PIN' : key}
                className="min-h-14 rounded-xl border border-gray-300 bg-white text-2xl font-black shadow-sm active:bg-amber-100"
              >
                {key === 'back' ? <Delete className="mx-auto" size={24} /> : key === 'clear' ? 'C' : key}
              </button>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 font-semibold text-red-800">{error}</p>}
        <button
          type="submit"
          disabled={busy || pin.length < 4 || !phone.trim()}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-gray-900 px-4 text-lg font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogIn aria-hidden="true" size={22} />
          {busy ? '…' : text.pinLogin}
        </button>
      </form>
      <p className="mt-6 text-center text-xs font-bold uppercase tracking-wider text-gray-500">
        SIMULATED sign-in
      </p>
    </main>
  );
}
