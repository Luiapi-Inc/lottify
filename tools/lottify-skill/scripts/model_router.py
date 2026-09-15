"""Resolve explicit provider/model profiles without invoking providers."""


def string_list(value, label):
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ValueError(f'{label} must be a list of nonempty strings')
    if len(value) != len(set(value)):
        raise ValueError(f'{label} contains duplicates')
    return value


def positive_integer(value, label):
    if type(value) is not int or value < 1:
        raise ValueError(f'{label} must be a positive integer')
    return value


def validate_runtime(runtime):
    if not isinstance(runtime, dict):
        raise ValueError('runtime must be a mapping')
    for section in ('providers', 'profiles', 'routing'):
        if not isinstance(runtime.get(section), dict):
            raise ValueError(f'runtime.{section} must be a mapping')
    for name, provider in runtime['providers'].items():
        if not isinstance(name, str) or not name or not isinstance(provider, dict):
            raise ValueError('provider entries require names and mappings')
        if type(provider.get('available')) is not bool:
            raise ValueError(f'provider {name}: available must be boolean')
        positive_integer(provider.get('max_parallel'), f'provider {name}.max_parallel')
    for name, profile in runtime['profiles'].items():
        if not isinstance(name, str) or not name or not isinstance(profile, dict):
            raise ValueError('profile entries require names and mappings')
        if profile.get('provider') not in runtime['providers']:
            raise ValueError(f'profile {name}: unknown provider')
        if 'model' not in profile or (profile['model'] is not None and (not isinstance(profile['model'], str) or not profile['model'].strip())):
            raise ValueError(f'profile {name}: model must be null (inherit) or a model ID')
        if type(profile.get('available')) is not bool:
            raise ValueError(f'profile {name}: available must be boolean')
        string_list(profile.get('capabilities'), f'profile {name}.capabilities')
    routing = runtime['routing']
    routes = [('default', routing.get('default'))]
    for section in ('roles', 'priorities'):
        mapping = routing.get(section, {})
        if not isinstance(mapping, dict):
            raise ValueError(f'routing.{section} must be a mapping')
        routes.extend((f'{section}.{name}', candidates) for name, candidates in mapping.items())
    for name, candidates in routes:
        validate_candidates(candidates, runtime, f'route {name}')


def validate_candidates(candidates, runtime, label):
    string_list(candidates, label)
    for profile in candidates:
        if profile not in runtime['profiles']:
            raise ValueError(f'{label}: unknown profile {profile}')


def choose_route(node, runtime, occupied):
    routing = runtime['routing']
    if 'profiles' in node:
        candidates, origin = node['profiles'], 'node'
    elif node['agent'] in routing.get('roles', {}):
        candidates, origin = routing['roles'][node['agent']], 'role'
    elif node['priority'] in routing.get('priorities', {}):
        candidates, origin = routing['priorities'][node['priority']], 'priority'
    else:
        candidates, origin = routing['default'], 'default'
    rejected = []
    for name in candidates:
        profile = runtime['profiles'][name]
        provider = runtime['providers'][profile['provider']]
        if not profile['available'] or not provider['available']:
            rejected.append(f'{name}: unavailable')
        elif not set(node['requires']).issubset(profile['capabilities']):
            rejected.append(f'{name}: required capabilities missing')
        elif occupied.get(profile['provider'], 0) >= provider['max_parallel']:
            rejected.append(f'{name}: provider capacity exhausted')
        else:
            return {
                'profile': name, 'provider': profile['provider'], 'model': profile['model'],
                'selected_by': origin, 'fallback_reasons': rejected,
            }, None
    return None, '; '.join(rejected) or f'{origin} route has no profiles'
