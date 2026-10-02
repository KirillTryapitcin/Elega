import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './avatar';
import { Button } from './button';
import { Input } from './input';

describe('Button', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Сохранить</Button>);
    expect(screen.getByRole('button', { name: 'Сохранить' }).getAttribute('type')).toBe('button');
  });

  it('renders the child element with asChild', () => {
    render(
      <Button asChild>
        <a href="/login">Войти</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Войти' });
    expect(link.className).toContain('rounded-full');
    expect(link.getAttribute('type')).toBeNull();
  });
});

describe('Input', () => {
  it('links label, hint and error for assistive technology', () => {
    render(<Input label="Почта" hint="Мы не покажем её другим" error="Неверный адрес" />);
    const input = screen.getByLabelText('Почта');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(described).toHaveLength(2);
    expect(screen.getByRole('alert').textContent).toBe('Неверный адрес');
  });
});

describe('Avatar', () => {
  it('falls back to initials from a Cyrillic name', () => {
    render(<Avatar name="анна петрова" />);
    expect(screen.getByLabelText('анна петрова').textContent).toBe('АП');
  });
});
