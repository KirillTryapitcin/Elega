import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardDescription, CardTitle } from './card';
import { Input } from './input';

const meta: Meta = { title: 'Kit/Overview' };
export default meta;

export const Buttons: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button>Опубликовать</Button>
      <Button variant="accent">Добавить в друзья</Button>
      <Button variant="soft">Подписаться</Button>
      <Button variant="outline">Отмена</Button>
      <Button variant="ghost">Ещё</Button>
      <Button variant="danger">Удалить</Button>
      <Button disabled>Недоступно</Button>
    </div>
  ),
};

export const PostCard: StoryObj = {
  render: () => (
    <Card className="max-w-xl space-y-3">
      <div className="flex items-center gap-3">
        <Avatar name="Анна Петрова" />
        <div>
          <CardTitle className="text-base">Анна Петрова</CardTitle>
          <CardDescription>2 часа назад · Для друзей</CardDescription>
        </div>
        <Badge tone="accent" className="ml-auto">
          Новое
        </Badge>
      </div>
      <p className="text-ink">
        Съездили на Байкал, лёд прозрачный, как стекло. Фотографии будут вечером.
      </p>
      <div className="flex gap-2">
        <Button variant="soft" size="sm">
          Нравится · 24
        </Button>
        <Button variant="ghost" size="sm">
          Комментировать
        </Button>
      </div>
    </Card>
  ),
};

export const Form: StoryObj = {
  render: () => (
    <Card className="max-w-sm space-y-4">
      <Input label="Электронная почта" type="email" placeholder="anna@example.ru" />
      <Input label="Пароль" type="password" error="Минимум 10 символов" />
      <Button className="w-full">Войти</Button>
    </Card>
  ),
};
